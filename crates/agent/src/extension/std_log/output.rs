//! Complete, best-effort stream records shared by access logs and diagnostics.
//! Linux pipe writes up to PIPE_BUF are all-or-nothing with O_NONBLOCK.
//! Sockets (e.g. systemd journal) use MSG_DONTWAIT directly without procfs reopen.
use std::collections::HashMap;
use std::fs::OpenOptions;
use std::io::{self, Write};
use std::os::fd::AsRawFd;
use std::os::unix::fs::OpenOptionsExt;
use std::sync::Mutex;
use std::time::Duration;

// Both producers use the kernel's atomic pipe-write boundary, never stdout's lock.
const MAX_RECORD_BYTES: usize = 4096;

static SOCKET_PENDING: Mutex<Option<HashMap<i32, Vec<u8>>>> = Mutex::new(None);

pub(crate) fn write_record(fd: i32, record: &[u8]) -> io::Result<()> {
    let record = record.strip_suffix(b"\n").unwrap_or(record);

    let is_socket = unsafe {
        let mut stat = std::mem::MaybeUninit::<libc::stat>::uninit();
        libc::fstat(fd, stat.as_mut_ptr()) == 0
            && (stat.assume_init().st_mode & libc::S_IFMT == libc::S_IFSOCK)
    };

    let file = if is_socket {
        None
    } else {
        match OpenOptions::new()
            .write(true)
            .custom_flags(libc::O_NONBLOCK | libc::O_CLOEXEC | libc::O_APPEND)
            .open(format!("/proc/self/fd/{fd}"))
        {
            Ok(f) => Some(f),
            Err(e) if e.raw_os_error() == Some(libc::ENXIO) => None,
            Err(e) => return Err(e),
        }
    };

    let limit = if let Some(ref f) = file {
        let pipe_buf = unsafe { libc::fpathconf(f.as_raw_fd(), libc::_PC_PIPE_BUF) };
        if pipe_buf > 0 {
            MAX_RECORD_BYTES.min(pipe_buf as usize)
        } else {
            MAX_RECORD_BYTES
        }
    } else {
        MAX_RECORD_BYTES
    };

    if record.len() >= limit {
        return Err(io::ErrorKind::InvalidData.into());
    }

    let mut framed = Vec::with_capacity(record.len() + 1);
    framed.extend_from_slice(record);
    framed.push(b'\n');

    if let Some(ref f) = file {
        let written = unsafe { libc::write(f.as_raw_fd(), framed.as_ptr().cast(), framed.len()) };
        if written < 0 {
            return Err(io::Error::last_os_error());
        }
        if written as usize != framed.len() {
            return Err(io::ErrorKind::WriteZero.into());
        }
        Ok(())
    } else {
        write_socket_record(fd, &framed)
    }
}

fn write_socket_record(fd: i32, framed: &[u8]) -> io::Result<()> {
    let mut lock = SOCKET_PENDING.lock().unwrap_or_else(|e| e.into_inner());
    let map = lock.get_or_insert_with(HashMap::new);

    // 1. Flush any pending unsent portion from previous partial writes to this socket.
    if let Some(pending) = map.get_mut(&fd) {
        if !pending.is_empty() {
            let (sent, err) = send_buffer(fd, pending, Duration::from_millis(50));
            if sent > 0 {
                pending.drain(..sent);
            }
            if !pending.is_empty() {
                return Err(err.unwrap_or_else(|| io::ErrorKind::WouldBlock.into()));
            }
        }
        map.remove(&fd);
    }

    // 2. Transmit framed record. If partial, retry within deadline before buffering.
    let (sent, err) = send_buffer(fd, framed, Duration::from_millis(50));
    if sent == framed.len() {
        Ok(())
    } else if sent == 0 {
        Err(err.unwrap_or_else(|| io::ErrorKind::WouldBlock.into()))
    } else {
        let pending = map.entry(fd).or_default();
        pending.extend_from_slice(&framed[sent..]);
        Err(io::ErrorKind::WouldBlock.into())
    }
}

fn send_buffer(fd: i32, buf: &[u8], timeout: Duration) -> (usize, Option<io::Error>) {
    let mut offset = 0;
    let deadline = std::time::Instant::now() + timeout;

    while offset < buf.len() {
        let res = unsafe {
            libc::send(
                fd,
                buf[offset..].as_ptr().cast(),
                buf.len() - offset,
                libc::MSG_DONTWAIT | libc::MSG_NOSIGNAL,
            )
        };
        if res > 0 {
            offset += res as usize;
        } else if res < 0 {
            let err = io::Error::last_os_error();
            if err.kind() == io::ErrorKind::WouldBlock {
                let now = std::time::Instant::now();
                if now >= deadline {
                    return (offset, Some(err));
                }
                let rem_ms = (deadline.saturating_duration_since(now).as_millis() as i32).max(1);
                let mut pfd = libc::pollfd {
                    fd,
                    events: libc::POLLOUT,
                    revents: 0,
                };
                let poll_res = unsafe { libc::poll(&mut pfd, 1, rem_ms) };
                if poll_res <= 0 {
                    return (offset, Some(err));
                }
            } else {
                return (offset, Some(err));
            }
        } else {
            return (offset, Some(io::ErrorKind::WriteZero.into()));
        }
    }
    (offset, None)
}

/// Buffer a tracing event so fmt's individual writes cannot split a record.
#[derive(Clone, Copy)]
pub struct DiagnosticWriter;

pub struct DiagnosticRecord(Vec<u8>);

impl<'a> tracing_subscriber::fmt::MakeWriter<'a> for DiagnosticWriter {
    type Writer = DiagnosticRecord;

    fn make_writer(&'a self) -> Self::Writer {
        DiagnosticRecord(Vec::new())
    }
}

impl Write for DiagnosticRecord {
    fn write(&mut self, bytes: &[u8]) -> io::Result<usize> {
        // Retain one excess byte to mark oversized events without unbounded buffering.
        let remaining = (MAX_RECORD_BYTES + 1).saturating_sub(self.0.len());
        self.0
            .extend_from_slice(&bytes[..bytes.len().min(remaining)]);
        Ok(bytes.len())
    }

    fn flush(&mut self) -> io::Result<()> {
        Ok(())
    }
}

impl Drop for DiagnosticRecord {
    fn drop(&mut self) {
        let _ = write_record(libc::STDOUT_FILENO, &self.0);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::os::fd::{FromRawFd, OwnedFd};

    #[test]
    fn full_pipe_drops_whole_records_and_recovers_without_changing_original_flags() {
        let mut fds = [0; 2];
        assert_eq!(unsafe { libc::pipe2(fds.as_mut_ptr(), libc::O_CLOEXEC) }, 0);
        let read = unsafe { OwnedFd::from_raw_fd(fds[0]) };
        let write = unsafe { OwnedFd::from_raw_fd(fds[1]) };
        let flags = unsafe { libc::fcntl(write.as_raw_fd(), libc::F_GETFL) };
        let line = vec![b'x'; 4095];
        let mut accepted = 0;
        loop {
            match write_record(write.as_raw_fd(), &line) {
                Ok(()) => accepted += 1,
                Err(e) if e.kind() == io::ErrorKind::WouldBlock => break,
                Err(e) => panic!("{e}"),
            }
        }
        assert!(accepted > 0);
        let start = std::time::Instant::now();
        for _ in 0..100 {
            assert_eq!(
                write_record(write.as_raw_fd(), b"blocked")
                    .unwrap_err()
                    .kind(),
                io::ErrorKind::WouldBlock
            );
        }
        assert!(start.elapsed() < std::time::Duration::from_secs(1));
        assert_eq!(
            unsafe { libc::fcntl(write.as_raw_fd(), libc::F_GETFL) },
            flags
        );
        let mut bytes = vec![0; accepted * 4096];
        let mut reader = std::fs::File::from(read);
        reader.read_exact(&mut bytes).unwrap();
        assert!(
            bytes
                .as_chunks::<4096>()
                .0
                .iter()
                .all(|c| c[4095] == b'\n' && c[..4095].iter().all(|b| *b == b'x'))
        );
        assert!(write_record(write.as_raw_fd(), b"recovered").is_ok());
        assert_eq!(
            write_record(write.as_raw_fd(), &vec![b'x'; 4096])
                .unwrap_err()
                .kind(),
            io::ErrorKind::InvalidData
        );
    }

    #[tokio::test]
    async fn repeated_shutdown_on_full_pipe_leaves_no_writer_tasks() {
        use crate::extension::std_log::worker::{LogStreamWriter, spawn_std_log_worker_inner};
        use crate::extension::std_log::{StdLogConfig, StdLogFormat, StdLogLevel};
        use crate::logs::GatewayLogEntry;
        use std::sync::Arc;
        struct PipeWriter(OwnedFd);
        impl LogStreamWriter for PipeWriter {
            fn write_stdout(&self, line: &str) {
                let _ = write_record(self.0.as_raw_fd(), line.as_bytes());
            }
            fn write_stderr(&self, line: &str) {
                self.write_stdout(line);
            }
        }
        let mut fds = [0; 2];
        assert_eq!(unsafe { libc::pipe2(fds.as_mut_ptr(), libc::O_CLOEXEC) }, 0);
        let _read = unsafe { OwnedFd::from_raw_fd(fds[0]) };
        let writer = Arc::new(PipeWriter(unsafe { OwnedFd::from_raw_fd(fds[1]) }));
        while write_record(writer.0.as_raw_fd(), &vec![b'x'; 4095]).is_ok() {}
        for _ in 0..20 {
            let config = StdLogConfig {
                enabled: true,
                format: StdLogFormat::Json,
                split_streams: true,
                log_level: StdLogLevel::All,
                include_waf_details: true,
            };
            let mut worker = spawn_std_log_worker_inner(config, None, writer.clone());
            worker
                .sender()
                .send(GatewayLogEntry::default())
                .await
                .unwrap();
            tokio::time::timeout(
                std::time::Duration::from_secs(1),
                worker.shutdown(std::time::Duration::from_millis(200)),
            )
            .await
            .unwrap();
            assert!(worker.is_terminated());
        }
    }

    #[test]
    fn concurrent_records_keep_their_newlines() {
        use std::sync::Arc;
        let mut fds = [0; 2];
        assert_eq!(unsafe { libc::pipe2(fds.as_mut_ptr(), libc::O_CLOEXEC) }, 0);
        let read = unsafe { OwnedFd::from_raw_fd(fds[0]) };
        let write = Arc::new(unsafe { OwnedFd::from_raw_fd(fds[1]) });
        let reader = std::thread::spawn(move || {
            let mut text = String::new();
            std::fs::File::from(read).read_to_string(&mut text).unwrap();
            text
        });
        let writers: Vec<_> = (0..2)
            .map(|i| {
                let fd = write.clone();
                std::thread::spawn(move || {
                    let line = format!("{{\"source\":{i},\"payload\":\"{}\"}}", "x".repeat(1000));
                    for _ in 0..100 {
                        loop {
                            match write_record(fd.as_raw_fd(), line.as_bytes()) {
                                Ok(()) => break,
                                Err(e) if e.kind() == io::ErrorKind::WouldBlock => {
                                    std::thread::yield_now()
                                }
                                Err(e) => panic!("{e}"),
                            }
                        }
                    }
                })
            })
            .collect();
        for writer in writers {
            writer.join().unwrap();
        }
        drop(write);
        let text = reader.join().unwrap();
        assert_eq!(text.lines().count(), 200);
        for line in text.lines() {
            let value: serde_json::Value = serde_json::from_str(line).unwrap();
            assert_eq!(value["payload"].as_str().unwrap().len(), 1000);
        }
    }

    #[test]
    fn socket_backed_stream_writes_records_and_recovers() {
        let mut fds = [0; 2];
        assert_eq!(
            unsafe {
                libc::socketpair(
                    libc::AF_UNIX,
                    libc::SOCK_STREAM | libc::SOCK_CLOEXEC,
                    0,
                    fds.as_mut_ptr(),
                )
            },
            0
        );
        let read = unsafe { OwnedFd::from_raw_fd(fds[0]) };
        let write = unsafe { OwnedFd::from_raw_fd(fds[1]) };
        let flags = unsafe { libc::fcntl(write.as_raw_fd(), libc::F_GETFL) };

        assert!(write_record(write.as_raw_fd(), b"journal entry").is_ok());
        assert_eq!(
            unsafe { libc::fcntl(write.as_raw_fd(), libc::F_GETFL) },
            flags
        );

        let mut buf = [0u8; 32];
        let n = unsafe { libc::read(read.as_raw_fd(), buf.as_mut_ptr().cast(), buf.len()) };
        assert_eq!(&buf[..n as usize], b"journal entry\n");

        let chunk = vec![b's'; 4095];
        let mut accepted = 0;
        loop {
            match write_record(write.as_raw_fd(), &chunk) {
                Ok(()) => accepted += 1,
                Err(e) if e.kind() == io::ErrorKind::WouldBlock => break,
                Err(e) => panic!("{e}"),
            }
        }
        assert!(accepted > 0);

        let mut drain = vec![0u8; accepted * 4096];
        let mut reader = std::fs::File::from(read);
        reader.read_exact(&mut drain).unwrap();

        assert!(write_record(write.as_raw_fd(), b"recovered").is_ok());
        assert_eq!(
            write_record(write.as_raw_fd(), &vec![b'x'; 4096])
                .unwrap_err()
                .kind(),
            io::ErrorKind::InvalidData
        );
    }

    #[test]
    fn socket_partial_write_preserves_line_boundaries_and_recovers() {
        let mut fds = [0; 2];
        assert_eq!(
            unsafe {
                libc::socketpair(
                    libc::AF_UNIX,
                    libc::SOCK_STREAM | libc::SOCK_CLOEXEC,
                    0,
                    fds.as_mut_ptr(),
                )
            },
            0
        );
        let read = unsafe { OwnedFd::from_raw_fd(fds[0]) };
        let write = unsafe { OwnedFd::from_raw_fd(fds[1]) };

        // Force partial write by constraining socket send buffer
        let sndbuf: libc::c_int = 4096;
        assert_eq!(
            unsafe {
                libc::setsockopt(
                    write.as_raw_fd(),
                    libc::SOL_SOCKET,
                    libc::SO_SNDBUF,
                    &sndbuf as *const _ as *const libc::c_void,
                    std::mem::size_of_val(&sndbuf) as libc::socklen_t,
                )
            },
            0
        );

        // Record 1: 4095 'A's
        let rec1 = vec![b'A'; 4095];
        assert!(write_record(write.as_raw_fd(), &rec1).is_ok());

        // Record 2: 4095 'B's -> partial write will retain remaining bytes
        let rec2 = vec![b'B'; 4095];
        let _ = write_record(write.as_raw_fd(), &rec2);

        // Record 3: while pending bytes remain, new write returns WouldBlock without corruption
        assert_eq!(
            write_record(write.as_raw_fd(), b"short")
                .unwrap_err()
                .kind(),
            io::ErrorKind::WouldBlock
        );

        // Drain reader non-blockingly
        let reader = std::fs::File::from(read);
        let mut drained = Vec::new();
        let mut chunk = [0u8; 8192];
        unsafe {
            let flags = libc::fcntl(reader.as_raw_fd(), libc::F_GETFL);
            libc::fcntl(reader.as_raw_fd(), libc::F_SETFL, flags | libc::O_NONBLOCK);
            loop {
                let n = libc::read(reader.as_raw_fd(), chunk.as_mut_ptr().cast(), chunk.len());
                if n > 0 {
                    drained.extend_from_slice(&chunk[..n as usize]);
                } else {
                    break;
                }
            }
        }

        // Record 4: finishes previous pending 'B's first, then writes rec4
        assert!(write_record(write.as_raw_fd(), b"clean recovery").is_ok());

        unsafe {
            loop {
                let n = libc::read(reader.as_raw_fd(), chunk.as_mut_ptr().cast(), chunk.len());
                if n > 0 {
                    drained.extend_from_slice(&chunk[..n as usize]);
                } else {
                    break;
                }
            }
        }

        let text = String::from_utf8(drained).unwrap();
        let lines: Vec<&str> = text.lines().collect();
        assert!(lines.len() >= 2);
        assert_eq!(lines[0].len(), 4095);
        assert!(lines[0].chars().all(|c| c == 'A'));
        assert_eq!(lines[1].len(), 4095);
        assert!(lines[1].chars().all(|c| c == 'B'));
        assert_eq!(lines.last().copied(), Some("clean recovery"));
    }

    use std::io::Read;
}

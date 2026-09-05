//! Aurora WAF Engine - Lõi xử lý và so khớp chính sách bảo mật bất biến (Immutable Snapshot).
//!
//! Nguyên lý thiết kế:
//! - Toàn bộ việc giải mã JSON, kiểm tra tính hợp lệ và tiền tính toán cây so khớp đều được
//!   thực hiện một lần duy nhất lúc nạp chính sách (trong hàm `from_policy`).
//! - Sau khi nạp xong, struct `Engine` hoàn toàn bất biến (read-only), không cấp phát thêm bộ nhớ động
//!   hoặc quét mảng vòng lặp trên từng request, đảm bảo tốc độ tra cứu tức thời O(1) và an toàn tuyệt đối
//!   trong môi trường đa luồng của NGINX worker.

pub mod access;
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};

/// Dung lượng tối đa của một tệp chính sách (64KB = 65,536 bytes)
pub const MAX_POLICY_BYTES: usize = 65_536;

/// Độ dài tối đa của một đường dẫn URL cần kiểm tra (8KB = 8,192 bytes)
pub const MAX_PATH_BYTES: usize = 8_192;

/// Các loại lỗi có thể xảy ra trong Engine
#[derive(Debug, PartialEq, Eq)]
pub enum Error {
    /// Chính sách JSON không hợp lệ hoặc vi phạm các quy tắc ràng buộc
    InvalidPolicy,
    /// Yêu cầu đường dẫn URL không hợp lệ (rỗng, quá dài, không bắt đầu bằng '/', chứa byte NUL)
    InvalidRequest,
}

/// Cấu trúc đại diện cho toàn bộ tệp chính sách JSON được giải mã từ Control Plane
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Policy {
    /// Phiên bản của cấu trúc chính sách (1: phiên bản cũ, 2: phiên bản nâng cao)
    schema_version: u32,
    /// Danh sách đường dẫn cần chặn (chỉ dùng cho Schema v1)
    #[serde(default)]
    block_paths: Option<Vec<String>>,
    /// Số thế hệ / phiên bản phát hành của chính sách (dùng cho Schema v2)
    #[serde(default)]
    generation: Option<u64>,
    /// Danh sách các luật bảo vệ chi tiết (dùng cho Schema v2)
    #[serde(default)]
    rules: Option<Vec<Rule>>,
    #[serde(default)]
    policies: Option<Vec<ScopedPolicy>>,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct ScopedPolicy {
    id: u64,
    host: String,
    path_prefix: String,
    priority: u32,
    rules: Vec<Rule>,
}
struct ScopeEngine {
    host: Vec<u8>,
    prefix: Vec<u8>,
    engine: Engine,
}

/// Định nghĩa một luật bảo vệ WAF trong Schema v2
#[derive(Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
struct Rule {
    /// Mã số định danh duy nhất của luật
    id: u64,
    /// Đường dẫn URL cần so khớp
    path: String,
    /// Hành vi xử lý khi khớp luật (cho qua, ghi log, hoặc chặn)
    action: Action,
    /// Điểm rủi ro tích lũy (0 đến 1000)
    score: u32,
    /// Thứ tự ưu tiên thực thi (số càng nhỏ càng ưu tiên chạy trước)
    priority: u32,
}

/// Hành vi xử lý của luật bảo vệ
#[derive(Deserialize, Serialize, Clone, Copy)]
#[serde(rename_all = "snake_case")]
enum Action {
    /// Cho phép gói tin đi qua
    Allow,
    /// Ghi nhận log cảnh báo nhưng không chặn gói tin
    Log,
    /// Chặn đứng gói tin và từ chối truy cập
    Block,
}

/// Quyết định xử lý trả về cho NGINX hoặc caller.
/// Sử dụng thuộc tính `#[repr(C)]` với các kiểu dữ liệu nguyên thủy (Value-only)
/// để tương thích trực tiếp với chuẩn C ABI mà không truyền con trỏ heap qua ranh giới FFI.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
#[repr(C)]
pub struct Decision {
    /// Số thế hệ của chính sách đang áp dụng
    pub generation: u64,
    /// Mã định danh của luật quyết định hành vi cuối cùng
    pub rule_id: u64,
    /// Hành vi xử lý: 0 là Allow (cho qua), 1 là Block (chặn)
    pub action: u32,
    /// Tổng điểm rủi ro tích lũy từ các luật khớp trên cùng đường dẫn
    pub score: u32,
    /// Số lượng luật ở chế độ Log đã khớp với đường dẫn này
    pub log_matches: u32,
    /// Trường dự phòng để căn chỉnh bộ nhớ 64-bit theo chuẩn C ABI
    pub reserved: u32,
}

/// Bộ máy Engine chính của Aurora WAF, chứa bảng băm tra cứu O(1) đã được tiền tính toán.
pub struct Engine {
    /// Số thế hệ phát hành của chính sách hiện hành
    generation: u64,
    /// Bảng băm chứa quyết định đã được tính toán sẵn cho từng đường dẫn URL
    decisions: HashMap<Vec<u8>, Decision>,
    scopes: Vec<ScopeEngine>,
}

impl Engine {
    /// Phân tích cú pháp, thẩm định và khởi tạo một instance Engine bất biến từ chuỗi byte JSON chính sách.
    pub fn from_policy(bytes: &[u8]) -> Result<Self, Error> {
        // Bước 1: Kiểm tra dung lượng đầu vào (không rỗng và không vượt quá 64KB)
        if bytes.is_empty() || bytes.len() > MAX_POLICY_BYTES {
            return Err(Error::InvalidPolicy);
        }

        // Bước 2: Giải mã chuỗi byte JSON thành struct Policy
        let policy: Policy = serde_json::from_slice(bytes).map_err(|_| Error::InvalidPolicy)?;

        // Cluster policy scope is bounded (64); all maps are built before worker
        // activation. First matching scope wins, lower priority then policy ID.
        if policy.schema_version == 3 {
            if policy.block_paths.is_some() || policy.rules.is_some() {
                return Err(Error::InvalidPolicy);
            }
            let generation = policy
                .generation
                .filter(|g| *g > 0 && *g <= i64::MAX as u64)
                .ok_or(Error::InvalidPolicy)?;
            let mut policies = policy.policies.ok_or(Error::InvalidPolicy)?;
            if policies.len() > 64 || policies.iter().map(|p| p.rules.len()).sum::<usize>() > 1024 {
                return Err(Error::InvalidPolicy);
            }
            policies.sort_by_key(|p| (p.priority, p.id));
            let mut ids = HashSet::new();
            let mut scopes = Vec::new();
            for p in policies {
                if p.id == 0
                    || !ids.insert(p.id)
                    || p.priority > 1_000_000
                    || p.host.is_empty()
                    || p.host.len() > 253
                    || (p.host != "*"
                        && p.host.split('.').any(|label| {
                            label.is_empty()
                                || label.len() > 63
                                || label.starts_with('-')
                                || label.ends_with('-')
                                || !label.bytes().all(|b| {
                                    b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'-'
                                })
                        }))
                    || !p.path_prefix.starts_with('/')
                    || p.path_prefix.len() > MAX_PATH_BYTES
                    || p.path_prefix
                        .bytes()
                        .any(|b| b <= 32 || b >= 127 || b"%?#\\*".contains(&b))
                    || p.path_prefix.contains("//")
                    || p.path_prefix.split('/').any(|s| s == "." || s == "..")
                {
                    return Err(Error::InvalidPolicy);
                }
                let bytes = serde_json::to_vec(&serde_json::json!({"schema_version":2,"generation":generation,"rules":p.rules})).map_err(|_| Error::InvalidPolicy)?;
                scopes.push(ScopeEngine {
                    host: p.host.into_bytes(),
                    prefix: p.path_prefix.into_bytes(),
                    engine: Self::from_policy(&bytes)?,
                });
            }
            return Ok(Self {
                generation,
                decisions: HashMap::new(),
                scopes,
            });
        }
        if policy.policies.is_some() {
            return Err(Error::InvalidPolicy);
        }

        // Bước 3: Phân nhánh xử lý theo phiên bản Schema Version
        let (generation, mut rules) = match policy.schema_version {
            // Schema v1: Cấu hình danh sách đường dẫn cần chặn đơn giản (block_paths)
            1 if policy.generation.is_none() && policy.rules.is_none() => {
                let paths = policy.block_paths.ok_or(Error::InvalidPolicy)?;
                let mut seen = HashSet::new();
                let mut rules = Vec::new();
                for path in paths {
                    // Ngăn chặn đường dẫn trùng lặp trong danh sách
                    if !seen.insert(path.clone()) {
                        return Err(Error::InvalidPolicy);
                    }
                    rules.push(Rule {
                        id: rules.len() as u64 + 1,
                        path,
                        action: Action::Block,
                        score: 0,
                        priority: 0,
                    });
                }
                (0, rules)
            }
            // Schema v2: Cấu hình nâng cao với generation và danh sách luật chi tiết
            2 if policy.block_paths.is_none() => {
                let generation = policy
                    .generation
                    .filter(|g| *g > 0 && *g <= i64::MAX as u64)
                    .ok_or(Error::InvalidPolicy)?;
                (generation, policy.rules.ok_or(Error::InvalidPolicy)?)
            }
            _ => return Err(Error::InvalidPolicy),
        };

        // Bước 4: Kiểm tra giới hạn số lượng luật tối đa không vượt quá 1024 luật
        if rules.len() > 1024 {
            return Err(Error::InvalidPolicy);
        }

        // Bước 5: Thẩm định từng luật về định dạng đường dẫn chuẩn hóa (Canonical Path) và giá trị số
        let mut ids = HashSet::new();
        for rule in &rules {
            if rule.id == 0
                || rule.id > i64::MAX as u64
                || !ids.insert(rule.id) // Kiểm tra tính duy nhất của ID luật
                || rule.score > 1000 // Điểm số từ 0 đến 1000
                || rule.priority > 1_000_000 // Độ ưu tiên từ 0 đến 1.000.000
                || !rule.path.starts_with('/') // Bắt buộc phải bắt đầu bằng '/'
                || rule.path.len() > MAX_PATH_BYTES // Không vượt quá 8KB
                || !rule.path.is_ascii() // Bắt buộc là ký tự ASCII
                || rule
                    .path
                    .bytes()
                    .any(|b| b <= 0x20 || b == 0x7f || b"%?#\\".contains(&b)) // Không chứa ký tự điều khiển hay escape
                || rule.path.contains("//") // Không chứa hai dấu gạch chéo liên tiếp
                || rule.path.split('/').any(|p| p == "." || p == "..")
            // Không chứa đường dẫn tương đối
            {
                return Err(Error::InvalidPolicy);
            }
        }

        // Bước 6: Sắp xếp các luật theo thứ tự ưu tiên (priority tăng dần), sau đó theo ID
        rules.sort_by_key(|r| (r.priority, r.id));

        // Bước 7: Tiền tính toán bảng băm quyết định (Precomputed Decision Map)
        let mut decisions = HashMap::new();
        let mut terminal = HashSet::new(); // Tập hợp các đường dẫn đã gặp hành động kết thúc (Allow hoặc Block)

        for rule in rules {
            // Nếu đường dẫn này đã có luật ưu tiên cao hơn quyết định Allow hoặc Block, bỏ qua các luật sau
            if terminal.contains(&rule.path) {
                continue;
            }

            let decision = decisions
                .entry(rule.path.as_bytes().to_vec())
                .or_insert(Decision {
                    generation,
                    ..Decision::default()
                });

            decision.rule_id = rule.id;
            decision.score += rule.score; // Cộng dồn điểm rủi ro từ các luật khớp

            match rule.action {
                Action::Log => {
                    // Hành vi Log: Chỉ tăng biến đếm số lượng luật Log khớp, tiếp tục cho các luật sau chạy
                    decision.log_matches += 1;
                }
                Action::Allow => {
                    // Hành vi Allow: Đóng băng quyết định (cho qua) và không xét các luật phía sau
                    terminal.insert(rule.path);
                }
                Action::Block => {
                    // Hành vi Block: Đánh dấu chặn (action = 1) và đóng băng quyết định
                    decision.action = 1;
                    terminal.insert(rule.path);
                }
            }
        }

        // Bước 8: Khởi tạo và trả về instance Engine bất biến
        Ok(Self {
            generation,
            decisions,
            scopes: Vec::new(),
        })
    }

    /// Trả về số thế hệ (generation) của chính sách hiện tại.
    pub fn generation(&self) -> u64 {
        self.generation
    }

    /// So khớp đường dẫn gói tin HTTP (path) với bảng quyết định để đưa ra phán quyết xử lý.
    /// Độ phức tạp thuật toán đạt O(1) nhờ tra cứu trực tiếp trong HashMap.
    pub fn evaluate(&self, path: &[u8]) -> Result<Decision, Error> {
        if !self.scopes.is_empty() {
            return Err(Error::InvalidRequest);
        }
        self.evaluate_request(b"", path)
    }

    pub fn evaluate_request(&self, host: &[u8], path: &[u8]) -> Result<Decision, Error> {
        // Kiểm tra tính hợp lệ của đường dẫn HTTP gửi vào:
        // - Không được rỗng
        // - Không vượt quá 8KB
        // - Phải bắt đầu bằng ký tự '/' (byte 0x2f)
        // - Không chứa byte NUL (0x00)
        if path.is_empty() || path.len() > MAX_PATH_BYTES || path[0] != b'/' || path.contains(&0) {
            return Err(Error::InvalidRequest);
        }

        if host.len() > 253 || host.contains(&0) {
            return Err(Error::InvalidRequest);
        }
        for scope in &self.scopes {
            let prefix = scope.prefix.as_slice();
            let in_path = path.starts_with(prefix)
                && (prefix.ends_with(b"/")
                    || path.len() == prefix.len()
                    || path.get(prefix.len()) == Some(&b'/'));
            if (scope.host == b"*" || scope.host.eq_ignore_ascii_case(host)) && in_path {
                return scope.engine.evaluate(path);
            }
        }

        // Tra cứu trong bảng băm:
        // - Nếu tìm thấy đường dẫn: trả về Decision đã được tính toán sẵn.
        // - Nếu không tìm thấy: trả về Decision mặc định với action = 0 (Allow) và generation hiện tại.
        Ok(self.decisions.get(path).copied().unwrap_or(Decision {
            generation: self.generation,
            ..Decision::default()
        }))
    }

    /// Hàm tiện ích kiểm tra nhanh xem đường dẫn có bị chặn hay không (action == 1).
    pub fn blocked(&self, path: &[u8]) -> Result<bool, Error> {
        Ok(self.evaluate(path)?.action == 1)
    }
}

// ─── Kiểm thử đơn vị (Unit Tests) ─────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn cluster_scope_priority_and_isolation() {
        let bytes=br#"{"schema_version":3,"generation":1000000000001,"policies":[
          {"id":2,"host":"*","path_prefix":"/","priority":100,"rules":[{"id":1,"path":"/admin/private","action":"block","score":5,"priority":0}]},
          {"id":1,"host":"admin.test","path_prefix":"/admin","priority":0,"rules":[{"id":1,"path":"/admin/private","action":"log","score":5,"priority":0}]}]}"#;
        let old = Engine::from_policy(bytes).unwrap();
        let new = Engine::from_policy(
            br#"{"schema_version":3,"generation":1000000000002,"policies":[]}"#,
        )
        .unwrap();
        assert_eq!(
            old.evaluate_request(b"ADMIN.TEST", b"/admin/private")
                .unwrap()
                .action,
            0
        );
        assert_eq!(
            old.evaluate_request(b"ADMIN.TEST", b"/admin/private")
                .unwrap()
                .log_matches,
            1
        );
        assert_eq!(
            old.evaluate_request(b"other.test", b"/admin/private")
                .unwrap()
                .action,
            1
        );
        assert_eq!(old.evaluate(b"/admin/private"), Err(Error::InvalidRequest));
        assert_eq!(
            new.evaluate_request(b"other.test", b"/admin/private")
                .unwrap()
                .action,
            0
        );
        assert_eq!(
            old.evaluate_request(b"other.test", b"/admin/private")
                .unwrap()
                .action,
            1
        );
        for bad in ["/../admin", "/admin*", "//admin"] {
            let invalid = String::from_utf8(bytes.to_vec())
                .unwrap()
                .replace("\"/admin\"", &format!("\"{bad}\""));
            assert!(Engine::from_policy(invalid.as_bytes()).is_err());
        }
        let boundary=Engine::from_policy(br#"{"schema_version":3,"generation":1,"policies":[{"id":1,"host":"*","path_prefix":"/admin","priority":0,"rules":[{"id":1,"path":"/administrator","action":"block","score":0,"priority":0}]}]}"#).unwrap();
        assert_eq!(
            boundary
                .evaluate_request(b"any.test", b"/administrator")
                .unwrap()
                .action,
            0
        );
    }

    /// Kiểm tra tính tương thích ngược và giới hạn biên của Schema v1
    #[test]
    fn legacy_bounds() {
        let e = Engine::from_policy(br#"{"schema_version":1,"block_paths":["/blocked"]}"#).unwrap();
        // Khớp chính xác đường dẫn bị chặn
        assert_eq!(e.blocked(b"/blocked"), Ok(true));
        // Đường dẫn con không bị chặn (chỉ khớp chính xác)
        assert_eq!(e.blocked(b"/blocked/child"), Ok(false));
        // Đường dẫn rỗng trả về lỗi InvalidRequest
        assert_eq!(e.blocked(b""), Err(Error::InvalidRequest));
        // Đường dẫn vượt quá 8KB trả về lỗi
        assert!(e.blocked(&vec![b'/'; MAX_PATH_BYTES + 1]).is_err());
    }

    /// Kiểm tra thứ tự ưu tiên giữa các hành vi và tính cô lập của snapshot thế hệ mới
    #[test]
    fn ordered_actions_and_snapshot_isolation() {
        // Chính sách thế hệ cũ (generation = 7): Log (ưu tiên 1) -> Allow (ưu tiên 2) -> Block (ưu tiên 3)
        // Luật Allow (priority 2) sẽ dừng việc so khớp trước khi gặp luật Block (priority 3)
        let old = Engine::from_policy(
            br#"{"schema_version":2,"generation":7,"rules":[
          {"id":3,"path":"/a","action":"block","score":9,"priority":3},
          {"id":2,"path":"/a","action":"allow","score":1,"priority":2},
          {"id":1,"path":"/a","action":"log","score":5,"priority":1}] }"#,
        )
        .unwrap();

        // Chính sách thế hệ mới (generation = 8): Chỉ có luật Block
        let new = Engine::from_policy(
            br#"{"schema_version":2,"generation":8,"rules":[{"id":3,"path":"/a","action":"block","score":9,"priority":3}]}"#,
        )
        .unwrap();

        // Kiểm tra kết quả tính toán trên snapshot cũ: action = 0 (Allow), score = 1 + 5 = 6, log_matches = 1
        assert_eq!(
            old.evaluate(b"/a").unwrap(),
            Decision {
                generation: 7,
                rule_id: 2,
                action: 0,
                score: 6,
                log_matches: 1,
                reserved: 0
            }
        );

        // Snapshot mới sẽ chặn đường dẫn '/a'
        assert!(new.blocked(b"/a").unwrap());
        // Snapshot cũ vẫn không chặn đường dẫn '/a' (cô lập hoàn toàn)
        assert!(!old.blocked(b"/a").unwrap());
        // Đường dẫn không khớp trả về generation của snapshot đó
        assert_eq!(new.evaluate(b"/other").unwrap().generation, 8);
    }

    /// Kiểm tra các trường hợp chính sách không hợp lệ bị từ chối
    #[test]
    fn invalid_policy() {
        for bytes in [
            br#"{"schema_version":2,"block_paths":[]}"#.as_slice(), // Schema v2 không được chứa block_paths
            br#"{"schema_version":1,"block_paths":["/a","/a"]}"#,   // Trùng lặp đường dẫn
            br#"{"schema_version":1,"block_paths":["/%61"]}"#,       // Chứa ký tự escape '%'
            br#"{"schema_version":1,"block_paths":["/a/../b"]}"#,   // Chứa đường dẫn tương đối '..'
            br#"{"schema_version":1,"block_paths":[],"unknown":true}"#, // Trường lạ không xác định
            br#"{"schema_version":2,"generation":1,"rules":[{"id":1,"path":"/a","action":"rate_limit","priority":0,"score":0}]}"#, // Action không hỗ trợ
            b"bad json", // Chuỗi JSON lỗi cú pháp
        ] {
            assert!(Engine::from_policy(bytes).is_err());
        }
        // Vượt quá kích thước tối đa 64KB
        assert!(Engine::from_policy(&vec![b' '; MAX_POLICY_BYTES + 1]).is_err());
    }
}

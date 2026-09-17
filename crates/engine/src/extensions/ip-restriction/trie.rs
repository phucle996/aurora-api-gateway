//! Binary Radix Trie (Longest Prefix Match) for IPv4 (32-bit) and IPv6 (128-bit).
//!
//! Provides deterministic O(bits) lookup performance independent of the number of registered CIDRs,
//! with zero warm heap allocations during lookup queries.

use std::net::{IpAddr, Ipv4Addr, Ipv6Addr};

#[derive(Clone, Debug)]
struct TrieNode<T> {
    children: [u32; 2],
    values: Vec<T>,
}

impl<T> Default for TrieNode<T> {
    fn default() -> Self {
        Self {
            children: [0, 0],
            values: Vec::new(),
        }
    }
}

/// Bitwise Radix Trie for IPv4 (up to 32 bit levels).
#[derive(Clone, Debug)]
pub struct Ipv4RadixTree<T> {
    nodes: Vec<TrieNode<T>>,
}

impl<T> Default for Ipv4RadixTree<T> {
    fn default() -> Self {
        Self::new()
    }
}

impl<T> Ipv4RadixTree<T> {
    pub fn new() -> Self {
        Self {
            nodes: vec![TrieNode::default()],
        }
    }

    /// Inserts a value for the given IPv4 address and prefix length.
    pub fn insert(&mut self, addr: Ipv4Addr, prefix: u8, value: T) {
        let prefix = prefix.min(32);
        let raw = u32::from(addr);
        let mut curr = 0usize;

        for bit in (32 - prefix..32).rev() {
            let b = ((raw >> bit) & 1) as usize;
            let mut next = self.nodes[curr].children[b];
            if next == 0 {
                next = self.nodes.len() as u32;
                self.nodes.push(TrieNode::default());
                self.nodes[curr].children[b] = next;
            }
            curr = next as usize;
        }

        self.nodes[curr].values.push(value);
    }

    /// Traverses the trie matching all enclosing subnets for the IP and invokes the callback.
    #[inline]
    pub fn for_each_match<'a, F>(&'a self, addr: Ipv4Addr, mut f: F)
    where
        F: FnMut(&'a T),
    {
        let raw = u32::from(addr);
        let mut curr = 0usize;

        for val in &self.nodes[curr].values {
            f(val);
        }

        for bit in (0..32).rev() {
            let b = ((raw >> bit) & 1) as usize;
            let next = self.nodes[curr].children[b];
            if next == 0 {
                break;
            }
            curr = next as usize;
            for val in &self.nodes[curr].values {
                f(val);
            }
        }
    }
}

/// Bitwise Radix Trie for IPv6 (up to 128 bit levels).
#[derive(Clone, Debug)]
pub struct Ipv6RadixTree<T> {
    nodes: Vec<TrieNode<T>>,
}

impl<T> Default for Ipv6RadixTree<T> {
    fn default() -> Self {
        Self::new()
    }
}

impl<T> Ipv6RadixTree<T> {
    pub fn new() -> Self {
        Self {
            nodes: vec![TrieNode::default()],
        }
    }

    /// Inserts a value for the given IPv6 address and prefix length.
    pub fn insert(&mut self, addr: Ipv6Addr, prefix: u8, value: T) {
        let prefix = prefix.min(128);
        let raw = u128::from(addr);
        let mut curr = 0usize;

        for bit in (128 - prefix..128).rev() {
            let b = ((raw >> bit) & 1) as usize;
            let mut next = self.nodes[curr].children[b];
            if next == 0 {
                next = self.nodes.len() as u32;
                self.nodes.push(TrieNode::default());
                self.nodes[curr].children[b] = next;
            }
            curr = next as usize;
        }

        self.nodes[curr].values.push(value);
    }

    /// Traverses the trie matching all enclosing subnets for the IP and invokes the callback.
    #[inline]
    pub fn for_each_match<'a, F>(&'a self, addr: Ipv6Addr, mut f: F)
    where
        F: FnMut(&'a T),
    {
        let raw = u128::from(addr);
        let mut curr = 0usize;

        for val in &self.nodes[curr].values {
            f(val);
        }

        for bit in (0..128).rev() {
            let b = ((raw >> bit) & 1) as usize;
            let next = self.nodes[curr].children[b];
            if next == 0 {
                break;
            }
            curr = next as usize;
            for val in &self.nodes[curr].values {
                f(val);
            }
        }
    }
}

/// Combined Dual-Stack IP Radix Tree.
#[derive(Clone, Debug)]
pub struct IpRadixTree<T> {
    v4: Ipv4RadixTree<T>,
    v6: Ipv6RadixTree<T>,
}

impl<T> Default for IpRadixTree<T> {
    fn default() -> Self {
        Self::new()
    }
}

impl<T> IpRadixTree<T> {
    pub fn new() -> Self {
        Self {
            v4: Ipv4RadixTree::new(),
            v6: Ipv6RadixTree::new(),
        }
    }

    pub fn insert(&mut self, ip: IpAddr, prefix: u8, value: T) {
        match ip {
            IpAddr::V4(v4) => self.v4.insert(v4, prefix, value),
            IpAddr::V6(v6) => self.v6.insert(v6, prefix, value),
        }
    }

    #[inline]
    pub fn for_each_match<'a, F>(&'a self, ip: IpAddr, f: F)
    where
        F: FnMut(&'a T),
    {
        match ip {
            IpAddr::V4(v4) => self.v4.for_each_match(v4, f),
            IpAddr::V6(v6) => self.v6.for_each_match(v6, f),
        }
    }
}

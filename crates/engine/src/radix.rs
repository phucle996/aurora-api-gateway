//! High-performance, zero-warm-allocation Path Radix Tree (Prefix Trie)
//! designed specifically for HTTP URL Path Prefix matching in Aurora Engine.
//!
//! ### Invariants:
//! 1. **Zero Warm Heap Allocations**: Lookup operations (`find_best`, `for_each_match`)
//!    perform zero heap allocations.
//! 2. **HTTP Path Delimiter Semantics**: A prefix `/api` matches `/api`, `/api/`,
//!    and `/api/users`, but NEVER matches `/apiv2`.
//! 3. **Deterministic Precedence**: Preserves exact order and priority semantics.

use std::fmt::Debug;

/// A node in the flattened arena-based Radix Tree.
#[derive(Clone, Debug)]
pub struct RadixNode<T> {
    /// Edge label fragment.
    pub prefix: Vec<u8>,
    /// Full cumulative path prefix represented by this node.
    pub full_prefix: Vec<u8>,
    /// Indices of child nodes in the arena.
    pub children: Vec<usize>,
    /// Values stored at this exact prefix boundary.
    pub values: Vec<T>,
}

/// Zero-allocation Path Radix Tree.
#[derive(Clone, Debug)]
pub struct PathRadixTree<T> {
    nodes: Vec<RadixNode<T>>,
}

impl<T> Default for PathRadixTree<T> {
    fn default() -> Self {
        Self::new()
    }
}

impl<T> PathRadixTree<T> {
    /// Creates an empty Path Radix Tree with an empty root node.
    pub fn new() -> Self {
        Self {
            nodes: vec![RadixNode {
                prefix: Vec::new(),
                full_prefix: Vec::new(),
                children: Vec::new(),
                values: Vec::new(),
            }],
        }
    }

    /// Checks if the tree has no values.
    pub fn is_empty(&self) -> bool {
        self.nodes.iter().all(|n| n.values.is_empty())
    }

    /// Inserts a value at the specified `path_prefix`.
    pub fn insert(&mut self, path_prefix: &[u8], value: T) {
        if self.nodes[0].prefix.is_empty()
            && self.nodes[0].children.is_empty()
            && self.nodes[0].values.is_empty()
        {
            // First insertion: set root prefix directly
            self.nodes[0].prefix = path_prefix.to_vec();
            self.nodes[0].full_prefix = path_prefix.to_vec();
            self.nodes[0].values.push(value);
            return;
        }

        let mut curr_idx = 0;
        let mut rem_key = path_prefix;

        loop {
            let common_len = common_prefix_len(&self.nodes[curr_idx].prefix, rem_key);

            if common_len < self.nodes[curr_idx].prefix.len() {
                // Must split current node
                let split_prefix = self.nodes[curr_idx].prefix[common_len..].to_vec();
                let full_prefix_child = self.nodes[curr_idx].full_prefix.clone();

                let split_len = split_prefix.len();
                let child_idx = self.nodes.len();
                let child_node = RadixNode {
                    prefix: split_prefix,
                    full_prefix: full_prefix_child,
                    children: std::mem::take(&mut self.nodes[curr_idx].children),
                    values: std::mem::take(&mut self.nodes[curr_idx].values),
                };
                self.nodes.push(child_node);

                self.nodes[curr_idx].prefix.truncate(common_len);
                let full_len = self.nodes[curr_idx].full_prefix.len();
                self.nodes[curr_idx]
                    .full_prefix
                    .truncate(full_len - split_len);
                self.nodes[curr_idx].children.push(child_idx);
            }

            rem_key = &rem_key[common_len..];

            if rem_key.is_empty() {
                // Exact match at this node
                self.nodes[curr_idx].values.push(value);
                return;
            }

            // Find a child that shares the first byte of rem_key
            let first_byte = rem_key[0];
            let mut found_child = None;
            for &c_idx in &self.nodes[curr_idx].children {
                if !self.nodes[c_idx].prefix.is_empty() && self.nodes[c_idx].prefix[0] == first_byte
                {
                    found_child = Some(c_idx);
                    break;
                }
            }

            match found_child {
                Some(next_idx) => {
                    curr_idx = next_idx;
                }
                None => {
                    // Create new child
                    let mut new_full_prefix = self.nodes[curr_idx].full_prefix.clone();
                    new_full_prefix.extend_from_slice(rem_key);

                    let new_child_idx = self.nodes.len();
                    self.nodes.push(RadixNode {
                        prefix: rem_key.to_vec(),
                        full_prefix: new_full_prefix,
                        children: Vec::new(),
                        values: vec![value],
                    });
                    self.nodes[curr_idx].children.push(new_child_idx);
                    return;
                }
            }
        }
    }

    /// Checks if a prefix represented by `full_prefix` is a valid HTTP path prefix match
    /// for the target `path`.
    #[inline(always)]
    fn is_path_boundary_match(full_prefix: &[u8], path: &[u8]) -> bool {
        if !path.starts_with(full_prefix) {
            return false;
        }
        full_prefix.ends_with(b"/")
            || path.len() == full_prefix.len()
            || path.get(full_prefix.len()) == Some(&b'/')
    }

    /// Traverses the tree and invokes `callback` for every matching rule along the path,
    /// in top-down prefix order.
    ///
    /// Performs **zero heap allocations**.
    #[inline]
    pub fn for_each_match<'a, F>(&'a self, path: &[u8], mut callback: F)
    where
        F: FnMut(&'a T),
    {
        if self.nodes.is_empty() {
            return;
        }

        let mut curr_idx = 0;
        let mut rem_path = path;

        loop {
            let node = &self.nodes[curr_idx];
            if !rem_path.starts_with(&node.prefix) {
                return;
            }

            rem_path = &rem_path[node.prefix.len()..];

            // If this node has values, verify path delimiter boundary
            if !node.values.is_empty() && Self::is_path_boundary_match(&node.full_prefix, path) {
                for val in &node.values {
                    callback(val);
                }
            }

            if rem_path.is_empty() {
                return;
            }

            // Find next child matching rem_path[0]
            let first_byte = rem_path[0];
            let mut next_idx = None;
            for &c_idx in &node.children {
                if !self.nodes[c_idx].prefix.is_empty() && self.nodes[c_idx].prefix[0] == first_byte
                {
                    next_idx = Some(c_idx);
                    break;
                }
            }

            match next_idx {
                Some(idx) => curr_idx = idx,
                None => return,
            }
        }
    }

    /// Finds the best matching value according to a comparator / key function,
    /// filtered by an optional predicate.
    ///
    /// Performs **zero heap allocations**.
    #[inline]
    pub fn find_best<'a, F, K, V>(
        &'a self,
        path: &[u8],
        mut filter: F,
        mut key_fn: K,
    ) -> Option<&'a T>
    where
        F: FnMut(&'a T) -> bool,
        K: FnMut(&'a T) -> V,
        V: Ord,
    {
        let mut best: Option<(&'a T, V)> = None;

        self.for_each_match(path, |val| {
            if filter(val) {
                let key = key_fn(val);
                match &best {
                    Some((_, best_key)) if key < *best_key => {
                        best = Some((val, key));
                    }
                    None => {
                        best = Some((val, key));
                    }
                    _ => {}
                }
            }
        });

        best.map(|(val, _)| val)
    }
}

#[inline(always)]
fn common_prefix_len(a: &[u8], b: &[u8]) -> usize {
    a.iter().zip(b.iter()).take_while(|(x, y)| x == y).count()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_empty_tree() {
        let tree: PathRadixTree<i32> = PathRadixTree::new();
        assert!(tree.is_empty());
        let mut matches = Vec::new();
        tree.for_each_match(b"/api", |v| matches.push(*v));
        assert!(matches.is_empty());
    }

    #[test]
    fn test_single_root_prefix() {
        let mut tree = PathRadixTree::new();
        tree.insert(b"/", 42);

        let mut matches = Vec::new();
        tree.for_each_match(b"/api/users", |v| matches.push(*v));
        assert_eq!(matches, vec![42]);

        matches.clear();
        tree.for_each_match(b"/", |v| matches.push(*v));
        assert_eq!(matches, vec![42]);
    }

    #[test]
    fn test_prefix_boundary_semantics() {
        let mut tree = PathRadixTree::new();
        tree.insert(b"/api", 100);
        tree.insert(b"/api/v1", 200);
        tree.insert(b"/api/v1/users", 300);

        // Path matches all three prefixes
        let mut matches = Vec::new();
        tree.for_each_match(b"/api/v1/users/list", |v| matches.push(*v));
        assert_eq!(matches, vec![100, 200, 300]);

        // Path matches only /api and /api/v1
        matches.clear();
        tree.for_each_match(b"/api/v1/orders", |v| matches.push(*v));
        assert_eq!(matches, vec![100, 200]);

        // Path /apiv2 should NOT match /api
        matches.clear();
        tree.for_each_match(b"/apiv2", |v| matches.push(*v));
        assert_eq!(matches, Vec::<i32>::new());

        // Exact match on /api
        matches.clear();
        tree.for_each_match(b"/api", |v| matches.push(*v));
        assert_eq!(matches, vec![100]);

        // Path /api/ matches /api
        matches.clear();
        tree.for_each_match(b"/api/", |v| matches.push(*v));
        assert_eq!(matches, vec![100]);
    }

    #[test]
    fn test_trailing_slash_prefix() {
        let mut tree = PathRadixTree::new();
        tree.insert(b"/api/", 999);

        // /api should NOT match /api/
        let mut matches = Vec::new();
        tree.for_each_match(b"/api", |v| matches.push(*v));
        assert_eq!(matches, Vec::<i32>::new());

        // /api/ matches /api/
        matches.clear();
        tree.for_each_match(b"/api/", |v| matches.push(*v));
        assert_eq!(matches, vec![999]);

        // /api/users matches /api/
        matches.clear();
        tree.for_each_match(b"/api/users", |v| matches.push(*v));
        assert_eq!(matches, vec![999]);
    }

    #[test]
    fn test_find_best_priority() {
        #[derive(Debug, PartialEq, Eq)]
        struct Rule {
            id: &'static str,
            priority: u32,
        }

        let mut tree = PathRadixTree::new();
        tree.insert(
            b"/",
            Rule {
                id: "root",
                priority: 100,
            },
        );
        tree.insert(
            b"/api",
            Rule {
                id: "api",
                priority: 50,
            },
        );
        tree.insert(
            b"/api/v1",
            Rule {
                id: "v1",
                priority: 10,
            },
        );

        let best = tree.find_best(b"/api/v1/checkout", |_| true, |r| r.priority);
        assert_eq!(
            best,
            Some(&Rule {
                id: "v1",
                priority: 10
            })
        );

        // If root has higher priority (smaller number)
        let mut tree2 = PathRadixTree::new();
        tree2.insert(
            b"/",
            Rule {
                id: "root",
                priority: 1,
            },
        );
        tree2.insert(
            b"/api",
            Rule {
                id: "api",
                priority: 50,
            },
        );
        tree2.insert(
            b"/api/v1",
            Rule {
                id: "v1",
                priority: 10,
            },
        );

        let best2 = tree2.find_best(b"/api/v1/checkout", |_| true, |r| r.priority);
        assert_eq!(
            best2,
            Some(&Rule {
                id: "root",
                priority: 1
            })
        );
    }

    #[test]
    fn test_branching_and_splitting() {
        let mut tree = PathRadixTree::new();
        tree.insert(b"/checkout/pay", 1);
        tree.insert(b"/checkout/cancel", 2);
        tree.insert(b"/checkin", 3);

        let mut matches = Vec::new();
        tree.for_each_match(b"/checkout/pay/card", |v| matches.push(*v));
        assert_eq!(matches, vec![1]);

        matches.clear();
        tree.for_each_match(b"/checkout/cancel", |v| matches.push(*v));
        assert_eq!(matches, vec![2]);

        matches.clear();
        tree.for_each_match(b"/checkin/guest", |v| matches.push(*v));
        assert_eq!(matches, vec![3]);

        matches.clear();
        tree.for_each_match(b"/other", |v| matches.push(*v));
        assert_eq!(matches, Vec::<i32>::new());
    }

    #[test]
    fn test_multiple_rules_same_prefix() {
        let mut tree = PathRadixTree::new();
        tree.insert(b"/api", 1);
        tree.insert(b"/api", 2);
        tree.insert(b"/api", 3);

        let mut matches = Vec::new();
        tree.for_each_match(b"/api/users", |v| matches.push(*v));
        assert_eq!(matches, vec![1, 2, 3]);
    }

    #[test]
    fn test_sibling_and_overlapping_prefixes() {
        let mut tree = PathRadixTree::new();
        tree.insert(b"/api/v1", 1);
        tree.insert(b"/api/v10", 10);
        tree.insert(b"/api/v2", 2);

        let mut matches = Vec::new();
        tree.for_each_match(b"/api/v1/users", |v| matches.push(*v));
        assert_eq!(matches, vec![1]);

        matches.clear();
        tree.for_each_match(b"/api/v10/users", |v| matches.push(*v));
        assert_eq!(matches, vec![10]);

        matches.clear();
        tree.for_each_match(b"/api/v2/users", |v| matches.push(*v));
        assert_eq!(matches, vec![2]);

        matches.clear();
        tree.for_each_match(b"/api/v100", |v| matches.push(*v));
        // /api/v100 should not match /api/v10 because 100 != 10/
        assert_eq!(matches, Vec::<i32>::new());
    }
}

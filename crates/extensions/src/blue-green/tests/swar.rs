use super::*;

#[test]
fn test_branchless_selection_arithmetic() {
    // valid_override = 1 -> returns candidate_slot
    assert_eq!(select_slot_branchless(1, SLOT_GREEN, SLOT_BLUE), SLOT_GREEN);
    assert_eq!(select_slot_branchless(1, SLOT_BLUE, SLOT_GREEN), SLOT_BLUE);

    // valid_override = 0 -> returns active_slot
    assert_eq!(select_slot_branchless(0, SLOT_GREEN, SLOT_BLUE), SLOT_BLUE);
    assert_eq!(select_slot_branchless(0, SLOT_BLUE, SLOT_GREEN), SLOT_GREEN);
}

#[test]
fn test_swar_slot_parser() {
    assert_eq!(parse_slot_swar(b"blue"), Some(SLOT_BLUE));
    assert_eq!(parse_slot_swar(b"BLUE"), Some(SLOT_BLUE));
    assert_eq!(parse_slot_swar(b"Blue"), Some(SLOT_BLUE));
    assert_eq!(parse_slot_swar(b"  blue \t"), Some(SLOT_BLUE));

    assert_eq!(parse_slot_swar(b"green"), Some(SLOT_GREEN));
    assert_eq!(parse_slot_swar(b"GREEN"), Some(SLOT_GREEN));
    assert_eq!(parse_slot_swar(b"Green"), Some(SLOT_GREEN));
    assert_eq!(parse_slot_swar(b"  green \r\n"), Some(SLOT_GREEN));

    assert_eq!(parse_slot_swar(b"staging"), None);
    assert_eq!(parse_slot_swar(b"canary"), None);
    assert_eq!(parse_slot_swar(b""), None);
    assert_eq!(parse_slot_swar(b"blu"), None);
    assert_eq!(parse_slot_swar(b"gree"), None);
}

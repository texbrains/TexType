//! The settings file: first start, writing and reading back, damaged and newer files, the sizes of a new formula.

use settings::{read, write, Error, UserSettings};
use std::fs;
use std::path::PathBuf;

/// A fresh folder for one test.
fn folder(name: &str) -> PathBuf {
    let path = std::env::temp_dir().join(format!("settings-test-{}-{name}", std::process::id()));
    let _ = fs::remove_dir_all(&path);
    fs::create_dir_all(&path).expect("temp folder");
    path
}

fn read_text(name: &str, text: &[u8]) -> Result<UserSettings, Error> {
    let path = folder(name).join("settings.json");
    fs::write(&path, text).expect("writes");
    read(&path)
}

#[test]
fn a_missing_file_means_all_defaults() {
    let path = folder("missing").join("settings.json");
    assert_eq!(read(&path), Ok(UserSettings::default()));
}

#[test]
fn written_settings_read_back_unchanged_and_leave_no_temporary_file() {
    let dir = folder("roundtrip");
    let path = dir.join("settings.json");
    let mut settings = UserSettings::default();
    settings.style.font_profile = "ntx".into();
    settings.style.display_size_pt = Some(14.0);
    settings.mathtype_double_click_opens_editor = false;
    write(&path, &settings).expect("writes");
    assert_eq!(read(&path), Ok(settings));
    let names: Vec<_> = fs::read_dir(&dir)
        .expect("lists")
        .map(|e| e.expect("entry").file_name())
        .collect();
    assert_eq!(names, vec!["settings.json"]);
    let text = fs::read_to_string(&path).expect("reads");
    assert!(text.contains("\"schemaVersion\": 1"));
}

#[test]
fn a_setting_missing_from_the_file_has_its_default() {
    let settings = read_text(
        "partial",
        br#"{"schemaVersion":1,"mathtypeDoubleClickOpensEditor":false}"#,
    )
    .expect("reads");
    assert!(!settings.mathtype_double_click_opens_editor);
    assert_eq!(settings.style, UserSettings::default().style);
}

#[test]
fn damaged_and_newer_files_are_refused() {
    assert_eq!(
        read_text("newer", br#"{"schemaVersion":2}"#),
        Err(Error::NewerSchema(2))
    );
    assert_eq!(
        read_text("noschema", br#"{"style":{}}"#),
        Err(Error::NoSchema)
    );
    assert_eq!(
        read_text("bom", b"\xEF\xBB\xBF{\"schemaVersion\":1}"),
        Err(Error::Bom)
    );
    assert_eq!(
        read_text("utf8", b"{\"schemaVersion\":1,\"x\":\"\xFF\"}"),
        Err(Error::NotUtf8)
    );
    assert!(matches!(
        read_text("json", b"{\"schemaVersion\":"),
        Err(Error::NotJson(_))
    ));
    assert!(matches!(
        read_text(
            "type",
            br#"{"schemaVersion":1,"mathtypeDoubleClickOpensEditor":"yes"}"#
        ),
        Err(Error::Schema(_))
    ));
}

#[test]
fn invalid_values_are_refused_by_field() {
    let field = |result: Result<UserSettings, Error>| match result {
        Err(Error::Invalid { field, .. }) => field,
        other => panic!("expected an invalid field, got {other:?}"),
    };
    assert_eq!(
        field(read_text(
            "color",
            br#"{"schemaVersion":1,"style":{"color":"red"}}"#
        )),
        "style.color"
    );
    assert_eq!(
        field(read_text(
            "size",
            br#"{"schemaVersion":1,"style":{"inlineSizePt":0}}"#
        )),
        "style.inlineSizePt"
    );
    assert_eq!(
        field(read_text(
            "profile",
            br#"{"schemaVersion":1,"style":{"fontProfile":""}}"#
        )),
        "style.fontProfile"
    );
}

#[test]
fn an_invalid_setting_is_not_written() {
    let path = folder("nowrite").join("settings.json");
    let mut settings = UserSettings::default();
    settings.style.color = "red".into();
    assert!(matches!(
        write(&path, &settings),
        Err(Error::Invalid {
            field: "style.color",
            ..
        })
    ));
    assert!(!path.exists());
}

#[test]
fn a_new_formula_follows_the_text_size_unless_a_size_is_set() {
    let mut style = UserSettings::default().style;
    assert_eq!(style.style_for(false, 10.5).size_pt, 10.5);
    style.display_size_pt = Some(14.0);
    assert_eq!(style.style_for(true, 10.5).size_pt, 14.0);
    assert_eq!(style.style_for(false, 10.5).size_pt, 10.5);
}

use crate::{Error, Result};
use std::collections::BTreeMap;
use zeroize::Zeroize;

#[derive(Default)]
pub struct Parsed {
    pub values: BTreeMap<String, String>,
    pub warnings: Vec<String>,
}
impl Drop for Parsed {
    fn drop(&mut self) {
        for v in self.values.values_mut() {
            v.zeroize();
        }
    }
}
pub fn valid_key(key: &str) -> bool {
    let mut chars = key.chars();
    chars
        .next()
        .is_some_and(|c| c.is_ascii_alphabetic() || c == '_')
        && chars.all(|c| c.is_ascii_alphanumeric() || c == '_')
}
fn error(line: usize, message: &str) -> Error {
    Error::Parse {
        line,
        message: message.into(),
    }
}
/// No variable interpolation. Single quotes are literal; double quotes support common escapes.
pub fn parse(input: &str) -> Result<Parsed> {
    let input = input.strip_prefix('\u{feff}').unwrap_or(input);
    let chars: Vec<char> = input.chars().collect();
    let mut i = 0;
    let mut line = 1;
    let mut out = Parsed::default();
    while i < chars.len() {
        while i < chars.len() && matches!(chars[i], ' ' | '\t' | '\r') {
            i += 1;
        }
        if i == chars.len() {
            break;
        }
        if chars[i] == '\n' {
            line += 1;
            i += 1;
            continue;
        }
        if chars[i] == '#' {
            while i < chars.len() && chars[i] != '\n' {
                i += 1;
            }
            continue;
        }
        let start_line = line;
        if chars[i..].starts_with(&['e', 'x', 'p', 'o', 'r', 't'])
            && chars.get(i + 6).is_some_and(|c| matches!(c, ' ' | '\t'))
        {
            i += 6;
            while i < chars.len() && matches!(chars[i], ' ' | '\t') {
                i += 1;
            }
        }
        let start = i;
        while i < chars.len() && !matches!(chars[i], '=' | '\n' | ' ' | '\t' | '\r') {
            i += 1;
        }
        let key: String = chars[start..i].iter().collect();
        if !valid_key(&key) {
            return Err(error(line, "Invalid variable name"));
        }
        while i < chars.len() && matches!(chars[i], ' ' | '\t') {
            i += 1;
        }
        if chars.get(i) != Some(&'=') {
            return Err(error(line, "Expected '='"));
        }
        i += 1;
        while i < chars.len() && matches!(chars[i], ' ' | '\t') {
            i += 1;
        }
        let mut value = zeroize::Zeroizing::new(String::new());
        if chars.get(i).is_some_and(|c| *c == '\'' || *c == '"') {
            let quote = chars[i];
            i += 1;
            let mut closed = false;
            while i < chars.len() {
                let c = chars[i];
                i += 1;
                if c == quote {
                    closed = true;
                    break;
                }
                if c == '\n' {
                    line += 1;
                }
                if c == '\\' && quote == '"' {
                    let next = *chars
                        .get(i)
                        .ok_or_else(|| error(line, "Incomplete escape"))?;
                    i += 1;
                    match next {
                        'n' => value.push('\n'),
                        'r' => value.push('\r'),
                        't' => value.push('\t'),
                        '"' => value.push('"'),
                        '\\' => value.push('\\'),
                        '$' => value.push('$'),
                        '\n' => {
                            line += 1;
                            value.push('\n');
                        }
                        _ => {
                            value.push('\\');
                            value.push(next);
                        }
                    }
                } else if c == '\r' && chars.get(i) == Some(&'\n') { /* normalize CRLF */
                } else {
                    value.push(c);
                }
            }
            if !closed {
                return Err(error(start_line, "Unterminated quoted value"));
            }
            while i < chars.len() && matches!(chars[i], ' ' | '\t' | '\r') {
                i += 1;
            }
            if chars.get(i) == Some(&'#') {
                while i < chars.len() && chars[i] != '\n' {
                    i += 1;
                }
            }
            if i < chars.len() && chars[i] != '\n' {
                return Err(error(line, "Unexpected characters after quoted value"));
            }
        } else {
            while i < chars.len() && chars[i] != '\n' {
                let c = chars[i];
                i += 1;
                if c == '#' {
                    while i < chars.len() && chars[i] != '\n' {
                        i += 1;
                    }
                    break;
                }
                if c == '\\' && i < chars.len() && chars[i] != '\n' {
                    value.push(chars[i]);
                    i += 1;
                } else {
                    value.push(c);
                }
            }
            let n = value.trim_end_matches([' ', '\t', '\r']).len();
            value.truncate(n);
        }
        if let Some(mut previous) = out.values.insert(key.clone(), std::mem::take(&mut *value)) {
            previous.zeroize();
            out.warnings.push(format!(
                "Line {start_line}: duplicate key {key}; last value wins"
            ));
        }
    }
    Ok(out)
}
pub fn encode(values: &BTreeMap<String, String>) -> String {
    if values.is_empty() {
        return "\n".into();
    }
    let mut out = String::new();
    for (k, v) in values {
        out.push_str(k);
        out.push_str("=\"");
        for c in v.chars() {
            match c {
                '\\' => out.push_str("\\\\"),
                '"' => out.push_str("\\\""),
                '\n' => out.push_str("\\n"),
                '\r' => out.push_str("\\r"),
                '\t' => out.push_str("\\t"),
                '$' => out.push_str("\\$"),
                _ => out.push(c),
            }
        }
        out.push_str("\"\n");
    }
    out
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn quotes_multiline_duplicates_and_no_expansion() {
        let p = parse(
            "export A=first\nA=\"line\\n${HOME}\"\nB='hello\nworld'\nC=escaped\\#value # comment\n",
        )
        .unwrap();
        assert_eq!(p.values["A"], "line\n${HOME}");
        assert_eq!(p.values["B"], "hello\nworld");
        assert_eq!(p.values["C"], "escaped#value");
        assert_eq!(p.warnings.len(), 1);
    }
    #[test]
    fn errors_have_lines_without_values() {
        let e = parse("OK=yes\nBAD=\"private\" trailing")
            .err()
            .unwrap()
            .to_string();
        assert!(e.contains("line 2"));
        assert!(!e.contains("private"));
        assert!(parse("K='unclosed").is_err());
        assert!(parse("1KEY=x").is_err());
    }
    #[test]
    fn canonical_roundtrip() {
        assert_eq!(encode(&BTreeMap::new()), "\n");
        let p = parse("Z='a\nb'\r\nA=\"quote\\\"\\\\\\t\\r${x}\"\nEMPTY=\n").unwrap();
        let encoded = encode(&p.values);
        assert!(encoded.starts_with("A="));
        assert!(encoded.ends_with('\n'));
        assert!(!encoded.contains('\r'));
        assert_eq!(parse(&encoded).unwrap().values, p.values);
    }
}

use chrono::{Datelike, Duration, NaiveDate};
use serde_json::{json, Value};

#[cfg(feature = "dav")]
pub mod dav;
pub fn date(s: &str) -> Result<NaiveDate, String> {
    if s.len() != 10
        || !s.bytes().enumerate().all(|(i, b)| {
            if i == 4 || i == 7 {
                b == b'-'
            } else {
                b.is_ascii_digit()
            }
        })
    {
        return Err("Invalid date".into());
    }
    NaiveDate::parse_from_str(s, "%Y-%m-%d").map_err(|_| "Invalid date".into())
}
pub fn add_days(s: &str, n: i64) -> String {
    date(s)
        .map(|d| (d + Duration::days(n)).to_string())
        .unwrap_or_default()
}
pub fn monday(s: &str) -> String {
    date(s)
        .map(|d| (d - Duration::days(d.weekday().num_days_from_monday() as i64)).to_string())
        .unwrap_or_default()
}
pub fn clamp_week(s: &str, start: &str, end: &str) -> String {
    monday(s).max(monday(start)).min(monday(end))
}
pub fn text<'a>(v: &'a Value, key: &str) -> &'a str {
    v.get(key).and_then(Value::as_str).unwrap_or("")
}
pub fn esc(s: &str) -> String {
    s.replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
        .replace('\'', "&#39;")
}
pub fn minutes(s: &str) -> i64 {
    s.split_once(':')
        .map(|(h, m)| h.parse::<i64>().unwrap_or(0) * 60 + m.parse::<i64>().unwrap_or(0))
        .unwrap_or(0)
}
pub fn normalize(s: &str) -> String {
    let mut out = String::new();
    let mut prev = ' ';
    for ch in s.to_lowercase().chars() {
        if (ch.is_ascii_alphabetic() && prev.is_ascii_digit())
            || (ch.is_ascii_digit() && prev.is_ascii_alphabetic())
        {
            out.push(' ');
        }
        out.push(if ch.is_ascii_alphanumeric() { ch } else { ' ' });
        prev = ch;
    }
    out.split_whitespace()
        .map(|w| match w {
            "semester" | "semster" | "semesters" => "sem",
            "group" | "grp" | "section" => "team",
            _ => w,
        })
        .collect::<Vec<_>>()
        .join(" ")
}
pub fn class_details(s: &str) -> Value {
    let normalized = normalize(s);
    let words = normalized.split_whitespace().collect::<Vec<_>>();
    let next = |key: &str| {
        words
            .windows(2)
            .find(|p| p[0] == key && p[1].chars().all(|c| c.is_ascii_digit()))
            .map(|p| p[1])
            .unwrap_or("")
    };
    let sem = next("sem");
    let mut group = next("team");
    if group.is_empty() && !sem.is_empty() {
        group = words
            .last()
            .copied()
            .filter(|w| w.chars().all(|c| c.is_ascii_digit()))
            .unwrap_or("");
    }
    if normalized == format!("sem {sem}") {
        group = "";
    }
    let up = s.to_uppercase();
    let mut programmes = up
        .split(|c: char| !c.is_ascii_alphanumeric() && c != '_')
        .filter(|w| {
            (w.len() == 4 && w.starts_with('D') && w.chars().all(|c| c.is_ascii_uppercase()))
                || ["GAPP", "GUFP", "GDVT", "BELT", "MTM"].contains(w)
        })
        .map(str::to_string)
        .collect::<Vec<_>>();
    programmes.sort();
    programmes.dedup();
    json!({"text":normalized,"semester":sem,"group":group,"programmes":programmes})
}
fn near(a: &str, b: &str) -> bool {
    let a = a.chars().collect::<Vec<_>>();
    let b = b.chars().collect::<Vec<_>>();
    if a.len() < 3 || a.len().abs_diff(b.len()) > 1 {
        return false;
    }
    if a.len() == b.len() {
        for i in 0..a.len() - 1 {
            let mut c = a.clone();
            c.swap(i, i + 1);
            if c == b {
                return true;
            }
        }
    }
    let mut row = (0..=b.len()).collect::<Vec<_>>();
    for (i, ca) in a.iter().enumerate() {
        let mut n = vec![i + 1];
        for (j, cb) in b.iter().enumerate() {
            n.push(
                (n[j] + 1)
                    .min(row[j + 1] + 1)
                    .min(row[j] + usize::from(ca != cb)),
            );
        }
        row = n;
    }
    row[b.len()] <= 1
}
pub fn search_classes(classes: &[Value], query: &str, filters: &Value) -> Vec<Value> {
    let norm = normalize(query);
    let words = norm.split_whitespace().collect::<Vec<_>>();
    let mut sem = "";
    let mut group = "";
    let mut remaining = Vec::new();
    let mut i = 0;
    while i < words.len() {
        if i + 1 < words.len()
            && (words[i] == "sem" || words[i] == "team")
            && words[i + 1].chars().all(|c| c.is_ascii_digit())
        {
            if words[i] == "sem" {
                sem = words[i + 1];
            } else {
                group = words[i + 1];
            }
            i += 2;
        } else {
            remaining.push(words[i]);
            i += 1;
        }
    }
    let mut out = Vec::new();
    for item in classes {
        let d = class_details(text(item, "name"));
        if [("semester", sem), ("group", group)]
            .iter()
            .any(|(key, q)| {
                (!q.is_empty() && text(&d, key) != *q)
                    || (!text(filters, key).is_empty() && text(filters, key) != text(&d, key))
            })
        {
            continue;
        }
        if !text(filters, "programme").is_empty()
            && !d["programmes"]
                .as_array()
                .unwrap()
                .iter()
                .any(|p| p.as_str() == Some(text(filters, "programme")))
        {
            continue;
        }
        let name = text(&d, "text");
        let mut fuzzy = false;
        if !remaining.iter().all(|term| {
            if name.split_whitespace().any(|w| {
                if term.chars().all(|c| c.is_ascii_digit()) {
                    w == *term
                } else {
                    w.contains(term)
                }
            }) {
                return true;
            }
            if name.split_whitespace().any(|w| near(term, w)) {
                fuzzy = true;
                return true;
            }
            false
        }) {
            continue;
        }
        let direct = !norm.is_empty() && name.replace(' ', "").contains(&norm.replace(' ', ""));
        let score = if fuzzy { 100 } else { 0 } - if direct { 10 } else { 0 }
            + if item["eventCount"].as_u64().unwrap_or(0) == 0 {
                10
            } else {
                0
            };
        let mut row = item.clone();
        row["fuzzy"] = json!(fuzzy);
        row["score"] = json!(score);
        out.push(row);
    }
    out.sort_by(|a, b| {
        a["score"]
            .as_i64()
            .cmp(&b["score"].as_i64())
            .then_with(|| natural(text(a, "name"), text(b, "name")))
    });
    out
}
fn natural(a: &str, b: &str) -> std::cmp::Ordering {
    fn split(s: &str) -> Vec<String> {
        let mut out = Vec::<String>::new();
        let mut digit = None;
        for c in s.chars() {
            let d = c.is_ascii_digit();
            if digit != Some(d) {
                out.push(String::new());
                digit = Some(d);
            }
            out.last_mut().unwrap().push(c);
        }
        out
    }
    for (x, y) in split(a).iter().zip(split(b).iter()) {
        let ord = match (x.parse::<u64>(), y.parse::<u64>()) {
            (Ok(a), Ok(b)) => a.cmp(&b),
            _ => x.cmp(y),
        };
        if !ord.is_eq() {
            return ord;
        }
    }
    a.len().cmp(&b.len())
}
pub fn filtered(events: &[Value], week: &str, query: &str) -> Vec<Value> {
    let end = add_days(week, 6);
    let q = query.to_lowercase();
    let words = q.split_whitespace().collect::<Vec<_>>();
    events
        .iter()
        .filter(|e| {
            text(e, "date") >= week
                && text(e, "date") <= end.as_str()
                && words.iter().all(|w| {
                    ["subject", "lecturer", "room", "note"]
                        .iter()
                        .map(|k| text(e, k))
                        .collect::<Vec<_>>()
                        .join(" ")
                        .to_lowercase()
                        .contains(w)
                })
        })
        .cloned()
        .collect()
}
fn ice(s: &str) -> String {
    s.replace('\\', "\\\\")
        .replace('\n', "\\n")
        .replace(';', "\\;")
        .replace(',', "\\,")
}
pub fn calendar(selected: &Value, events: &[Value], stamp: &str) -> String {
    let mut lines = vec![
        "BEGIN:VCALENDAR".into(),
        "VERSION:2.0".into(),
        "PRODID:-//Student Timetable//Class Calendar//EN".into(),
        "CALSCALE:GREGORIAN".into(),
        format!("X-WR-CALNAME:{}", ice(text(selected, "name"))),
        "BEGIN:VTIMEZONE".into(),
        "TZID:Asia/Kuala_Lumpur".into(),
        "BEGIN:STANDARD".into(),
        "DTSTART:19700101T000000".into(),
        "TZOFFSETFROM:+0800".into(),
        "TZOFFSETTO:+0800".into(),
        "TZNAME:MYT".into(),
        "END:STANDARD".into(),
        "END:VTIMEZONE".into(),
    ];
    for e in events {
        let date = text(e, "date").replace('-', "");
        let (enddate, endtime) = if text(e, "end") == "24:00" {
            (
                add_days(text(e, "date"), 1).replace('-', ""),
                "0000".to_string(),
            )
        } else {
            (date.clone(), text(e, "end").replace(':', ""))
        };
        let mut description = format!(
            "Reconstructed timetable. Confirm changes with your lecturer.\nClass: {}",
            text(selected, "name")
        );
        for (label, key) in [
            ("Class", "className"),
            ("Lecturer", "lecturer"),
            ("Notes", "note"),
            ("Calendar exception", "exception"),
        ] {
            if !text(e, key).is_empty() {
                description += &format!("\n{label}: {}", text(e, key));
            }
        }
        if e["overlap"] == true {
            description += "\nOverlapping class entry: check with lecturer.";
        }
        lines.extend([
            "BEGIN:VEVENT".into(),
            format!("UID:{}@student-timetable.local", text(e, "id")),
            format!("DTSTAMP:{stamp}"),
            format!(
                "DTSTART;TZID=Asia/Kuala_Lumpur:{date}T{}00",
                text(e, "start").replace(':', "")
            ),
            format!("DTEND;TZID=Asia/Kuala_Lumpur:{enddate}T{endtime}00"),
            format!(
                "SUMMARY:{}",
                ice(&format!(
                    "{} - {}",
                    text(selected, "name"),
                    text(e, "subject")
                ))
            ),
            format!("LOCATION:{}", ice(text(e, "room"))),
            format!("DESCRIPTION:{}", ice(&description)),
            "STATUS:TENTATIVE".into(),
            "END:VEVENT".into(),
        ]);
    }
    lines.push("END:VCALENDAR".into());
    let mut folded = Vec::new();
    for line in lines {
        let mut part = String::new();
        for ch in line.chars() {
            if part.len() + ch.len_utf8() > 75 {
                folded.push(part);
                part = " ".into();
            }
            part.push(ch);
        }
        folded.push(part);
    }
    folded.join("\r\n") + "\r\n"
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn dates() {
        assert_eq!(monday("2026-10-22"), "2026-10-19");
        assert_eq!(add_days("2026-12-31", 1), "2027-01-01");
        assert!(date("2026-02-30").is_err());
    }
    #[test]
    fn search() {
        let rows = vec![
            json!({"id":"1","name":"SEM 3 - DMCH 1","eventCount":5}),
            json!({"id":"2","name":"SEM 3 - DMCH 10","eventCount":4}),
        ];
        assert_eq!(
            search_classes(&rows, "dmch semester 3 group 1", &json!({})).len(),
            1
        );
        assert_eq!(search_classes(&rows, "dmhc sem3", &json!({})).len(), 2);
    }
}
pub fn normalise_air(payload: &Value, now: f64) -> Result<Value, String> {
    let rows = payload["data"]
        .as_array()
        .ok_or("Unexpected DOE station response")?;
    let mut stations = Vec::new();
    for (id, name) in [
        ("CA17W", "Putrajaya, W.P. PUTRAJAYA"),
        ("CA16W", "Cheras, W.P. KUALA LUMPUR"),
    ] {
        let found = rows
            .iter()
            .filter(|r| text(r, "STATION_ID") == id)
            .collect::<Vec<_>>();
        let mut station =
            json!({"id":id,"name":name,"value":null,"category":null,"observedAt":null});
        if found.len() == 1 {
            let row = found[0];
            let value = row["API"].as_u64();
            let category = match value {
                Some(0..=50) => "Good",
                Some(51..=100) => "Moderate",
                Some(101..=200) => "Unhealthy",
                Some(201..=300) => "Very Unhealthy",
                Some(301..=1000) => "Hazardous",
                _ => "",
            };
            let raw = text(row, "RECORD_DT");
            let time = chrono::DateTime::parse_from_rfc3339(raw)
                .map(|d| d.timestamp_millis())
                .or_else(|_| {
                    chrono::NaiveDateTime::parse_from_str(raw, "%Y-%m-%dT%H:%M:%S%.f")
                        .map(|d| d.and_utc().timestamp_millis() - 28800000)
                });
            if let Ok(time) = time {
                if !category.is_empty()
                    && text(row, "CLASS") == category
                    && text(row, "STATION_LOCATION").starts_with(name.split(',').next().unwrap())
                    && time as f64 <= now + 900000.
                {
                    station["value"] = json!(value.unwrap());
                    station["category"] = json!(category);
                    station["observedAt"] = json!(chrono::DateTime::from_timestamp_millis(time)
                        .unwrap()
                        .to_rfc3339_opts(chrono::SecondsFormat::Millis, true));
                }
            }
        }
        stations.push(station);
    }
    Ok(
        json!({"schemaVersion":1,"fetchedAt":chrono::DateTime::from_timestamp_millis(now as i64).ok_or("Invalid clock")?.to_rfc3339_opts(chrono::SecondsFormat::Millis,true),"stations":stations}),
    )
}

/// Mark interval overlaps by day in O(n log n). Decoder UIDs are unique by construction.
pub fn mark_overlaps(events: &mut [Value]) {
    let mut days = std::collections::BTreeMap::<String, Vec<usize>>::new();
    for (i, e) in events.iter().enumerate() {
        days.entry(text(e, "date").into()).or_default().push(i);
    }
    for indexes in days.values_mut() {
        indexes.sort_by(|&a, &b| {
            text(&events[a], "start")
                .cmp(text(&events[b], "start"))
                .then(text(&events[a], "end").cmp(text(&events[b], "end")))
        });
        let mut max_end = String::new();
        for (position, &i) in indexes.iter().enumerate() {
            let previous = max_end.as_str() > text(&events[i], "start");
            let next = indexes
                .get(position + 1)
                .map(|&j| text(&events[i], "end") > text(&events[j], "start"))
                .unwrap_or(false);
            if text(&events[i], "end") > max_end.as_str() {
                max_end = text(&events[i], "end").into();
            }
            events[i]["overlap"] = json!(previous || next);
        }
    }
}

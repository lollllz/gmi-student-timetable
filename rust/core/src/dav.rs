use crate::{add_days, monday, text};
use chrono::{Duration, NaiveDate};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::collections::{BTreeMap, BTreeSet};
const FAIL:&str="This file uses a timetable layout we can’t read yet. Supported: compatible legacy .dav files with the V30 format.";
type R<T> = Result<T, String>;
fn need(b: bool) -> R<()> {
    if b {
        Ok(())
    } else {
        Err(FAIL.into())
    }
}
#[derive(Clone)]
struct Reader<'a> {
    b: &'a [u8],
    p: usize,
}
impl<'a> Reader<'a> {
    fn new(b: &'a [u8], p: usize) -> Self {
        Self { b, p }
    }
    fn take(&mut self, n: usize) -> R<&'a [u8]> {
        let end = self.p.checked_add(n).ok_or(FAIL)?;
        let slice = self.b.get(self.p..end).ok_or(FAIL)?;
        self.p = end;
        Ok(slice)
    }
    fn u8(&mut self) -> R<u8> {
        Ok(self.take(1)?[0])
    }
    fn u16(&mut self) -> R<u16> {
        Ok(u16::from_le_bytes(self.take(2)?.try_into().unwrap()))
    }
    fn u32(&mut self) -> R<u32> {
        Ok(u32::from_le_bytes(self.take(4)?.try_into().unwrap()))
    }
    fn i32(&mut self) -> R<i64> {
        let n = self.u32()?;
        Ok(if n == u32::MAX { -1 } else { n as i64 })
    }
    fn f32(&mut self) -> R<f32> {
        let n = f32::from_le_bytes(self.take(4)?.try_into().unwrap());
        need(n.is_finite())?;
        Ok(n)
    }
    fn f64(&mut self) -> R<f64> {
        let n = f64::from_le_bytes(self.take(8)?.try_into().unwrap());
        need(n.is_finite())?;
        Ok(n)
    }
    fn mask(&mut self) -> R<u64> {
        Ok(u64::from_le_bytes(self.take(8)?.try_into().unwrap()))
    }
    fn val(&mut self) -> R<Value> {
        match self.u8()? {
            2 => Ok(json!(self.u8()? as i8)),
            3 => Ok(json!(self.u16()? as i16)),
            4 => Ok(json!(self.u32()? as i32)),
            15 => Ok(json!(self.f32()?)),
            8 => Ok(json!(false)),
            9 => Ok(json!(true)),
            6 => {
                let len = self.u8()? as usize;
                Ok(json!(encoding_rs::WINDOWS_1252
                    .decode(self.take(len)?)
                    .0
                    .to_string()))
            }
            _ => Err(FAIL.into()),
        }
    }
    fn string(&mut self) -> R<String> {
        self.val()?.as_str().map(str::to_string).ok_or(FAIL.into())
    }
    fn count(&mut self, max: usize) -> R<usize> {
        let n = self.val()?.as_i64().ok_or(FAIL)?;
        need(n >= 0 && n as usize <= max)?;
        Ok(n as usize)
    }
}
fn serial(n: f64) -> R<String> {
    need((32874. ..=73416.).contains(&n))?;
    Ok(
        (NaiveDate::from_ymd_opt(1899, 12, 30).unwrap() + Duration::days(n.floor() as i64))
            .to_string(),
    )
}
fn before(b: &[u8], p: usize, max: usize) -> usize {
    for (len, tag) in [(2, 2), (3, 3), (5, 4)] {
        if p >= len && b[p - len] == tag {
            let mut r = Reader::new(b, p - len);
            if let Ok(n) = r.count(max) {
                if n > 0 && r.p == p {
                    return n;
                }
            }
        }
    }
    0
}
#[derive(Clone)]
struct Name {
    p: usize,
    id: u32,
    name: String,
}
fn names(b: &[u8]) -> Vec<Name> {
    let mut out = Vec::new();
    for m in 4..b.len().saturating_sub(4) {
        if b[m..m + 3] != [2, 255, 6] {
            continue;
        }
        let n = b[m + 3] as usize;
        if n == 0 || m + 4 + n > b.len() {
            continue;
        }
        let raw = &b[m + 4..m + 4 + n];
        if raw.iter().any(|v| *v < 32 || *v == 127) {
            continue;
        }
        out.push(Name {
            p: m - 4,
            id: u32::from_le_bytes(b[m - 4..m].try_into().unwrap()),
            name: encoding_rs::WINDOWS_1252.decode(raw).0.to_string(),
        });
    }
    out
}
fn calendar_section(b: &[u8], first: usize) -> R<(usize, usize, Vec<Value>)> {
    for p in 4..first {
        if b.get(p + 25) != Some(&6) || b.get(p + 16..p + 24) != Some(&[255; 8][..]) {
            continue;
        }
        let n = before(b, p, 2000);
        if n == 0 {
            continue;
        }
        let attempt = (|| {
            let mut r = Reader::new(b, p);
            let mut exceptions = Vec::new();
            for _ in 0..n {
                let start = serial(r.f64()?)?;
                let end = serial(r.f64()?)?;
                need(start <= end && r.i32()? == -1 && r.i32()? == -1)?;
                need(r.u8()? <= 10)?;
                let name = r.string()?.trim().to_string();
                exceptions.push(json!({"start":start,"end":end,"name":name}));
            }
            r.take(8)?;
            let count = r.count(5000)?;
            need(count > 0 && r.p == first)?;
            Ok((p, count, exceptions))
        })();
        if attempt.is_ok() {
            return attempt;
        }
    }
    Err(FAIL.into())
}
fn periods(b: &[u8], before: usize, duration: u32) -> R<(String, Vec<u32>)> {
    for p in 64..before {
        if b[p] != 6 {
            continue;
        }
        let attempt = (|| {
            let mut r = Reader::new(b, p);
            let title = r.string()?;
            need(title.len() >= 3)?;
            r.string()?;
            need(r.val()?.is_boolean())?;
            let count = r.count(48)?;
            need(count > 0)?;
            let mut periods = Vec::new();
            for _ in 0..count {
                let start = r.u16()? as u32;
                need(r.take(8)?.iter().all(|v| *v == 0))?;
                need(
                    start + duration <= 1440 && periods.last().map(|v| start > *v).unwrap_or(true),
                )?;
                periods.push(start);
            }
            need(r.p < before)?;
            Ok((title, periods))
        })();
        if attempt.is_ok() {
            return attempt;
        }
    }
    Err(FAIL.into())
}
#[derive(Clone, Serialize, Deserialize)]
pub struct Slot {
    pub offset: usize,
    pub id: u32,
    pub day: u8,
    pub period: u8,
    pub flag: u8,
    pub room: i64,
    pub lecturer: i64,
}
type Pattern = (String, Vec<i64>);
struct Lesson {
    id: u32,
    coupling: i64,
    class_id: i64,
    subject: i64,
    note: String,
    note_offset: usize,
    note_end: usize,
    bits: Vec<i64>,
    slots: Vec<Slot>,
}
fn bits(mask: u64) -> Vec<i64> {
    (0..64)
        .filter(|b| mask & (1u64 << b) == 0)
        .map(|b| b as i64)
        .collect()
}
fn timetable(
    b: &[u8],
    p: usize,
    count: usize,
    period_count: usize,
) -> R<(Vec<Pattern>, Vec<Lesson>)> {
    let mut r = Reader::new(b, p);
    let mut patterns = Vec::new();
    for _ in 0..count {
        r.u32()?;
        need(r.val()? == -1)?;
        let name = r.string()?;
        r.string()?;
        let mask = r.mask()?;
        for _ in 0..4 {
            r.f32()?;
        }
        patterns.push((name, bits(mask)));
    }
    let groups = r.count(5000)?;
    for _ in 0..groups {
        r.u32()?;
        need(r.val()? == -1)?;
        r.string()?;
        r.string()?;
        let n = r.count(10000)?;
        r.take(n * 24)?;
    }
    let count = r.count(30000)?;
    need(count > 0 && r.val()? == 0)?;
    let mut lessons = Vec::new();
    let (mut lids, mut sids) = (BTreeSet::new(), BTreeSet::new());
    for _ in 0..count {
        let id = r.u32()?;
        need(lids.insert(id))?;
        let refs = [r.i32()?, r.i32()?, r.i32()?, r.i32()?];
        let n = r.count(1000)?;
        let mut slots = Vec::new();
        for _ in 0..n {
            let sid = r.u32()?;
            need(sids.insert(sid) && sids.len() <= 150000 && r.u32()? == id)?;
            let offset = r.p;
            let layout = r.take(18)?;
            need(
                layout[0] <= 7
                    && layout[1] as usize <= period_count
                    && layout[2..9].iter().all(|v| *v == 0)
                    && layout[9] == 1
                    && layout[10..17].iter().all(|v| *v == 0),
            )?;
            need(r.val()? == 0 && r.val()? == 0)?;
            let room = r.i32()?;
            let lecturer = r.i32()?;
            r.i32()?;
            slots.push(Slot {
                offset,
                id: sid,
                day: layout[0],
                period: layout[1],
                flag: layout[17],
                room,
                lecturer,
            });
        }
        r.i32()?;
        let mask = r.mask()?;
        r.val()?;
        r.val()?;
        let note_offset = r.p;
        let note = r.string()?;
        let note_end = r.p;
        let subject = r.i32()?;
        r.i32()?;
        r.val()?;
        r.val()?;
        r.u8()?;
        r.string()?;
        r.string()?;
        for _ in 0..8 {
            r.val()?;
        }
        r.string()?;
        r.val()?;
        let raw = r.take(11)?;
        need(u32::from_le_bytes(raw[3..7].try_into().unwrap()) as usize == n)?;
        need(r.val()? == 1 && r.val()? == 6 && r.val()? == "" && r.val()? == 0)?;
        lessons.push(Lesson {
            id,
            coupling: refs[0],
            class_id: refs[1],
            subject,
            note,
            note_offset,
            note_end,
            bits: bits(mask),
            slots,
        });
    }
    for _ in 0..3 {
        r.val()?;
    }
    let reasons = r.count(100)?;
    for _ in 0..reasons {
        r.string()?;
    }
    r.take(40)?;
    for _ in 0..4 {
        r.val()?;
    }
    need(r.p == b.len())?;
    Ok((patterns, lessons))
}
fn anchor(patterns: &[(String, Vec<i64>)], start: &str) -> R<String> {
    let re = regex::Regex::new(r"^CW(\d+)(?: (\d{4}))?$").unwrap();
    let (mut explicit, mut generic) = (Vec::new(), Vec::new());
    for (name, bits) in patterns {
        let Some(c) = re.captures(name.trim()) else {
            continue;
        };
        let n = c[1].parse::<i64>().unwrap_or(0);
        if bits.len() != 1 || !(1..=53).contains(&n) {
            continue;
        }
        let year = c.get(2).map(|m| m.as_str()).unwrap_or(&start[..4]);
        let value = add_days(&monday(&format!("{year}-01-04")), (n - 1 - bits[0]) * 7);
        if c.get(2).is_some() {
            explicit.push(value)
        } else {
            generic.push(value)
        }
    }
    let choices = if explicit.is_empty() {
        generic
    } else {
        explicit
    };
    need(!choices.is_empty())?;
    let mut counts = BTreeMap::<String, usize>::new();
    for c in choices {
        *counts.entry(c).or_default() += 1;
    }
    let mut ranks = counts.into_iter().collect::<Vec<_>>();
    ranks.sort_by_key(|a| std::cmp::Reverse(a.1));
    need(ranks.len() == 1 || ranks[0].1 > ranks[1].1)?;
    Ok(ranks[0].0.clone())
}
fn clock(n: u32) -> String {
    format!("{:02}:{:02}", n / 60, n % 60)
}
pub fn decode(b: &[u8], filename: &str) -> R<Value> {
    decode_inner(b, filename, true)
}
pub fn decode_for_publish(b: &[u8], filename: &str) -> R<Value> {
    decode_inner(b, filename, false)
}
fn decode_inner(b: &[u8], filename: &str, include_editor: bool) -> R<Value> {
    need(b.len() > 200 && b.len() <= 20 * 1024 * 1024 && b[..4] == [3, 86, 51, 48])?;
    let names = names(b);
    need(names.len() > 4)?;
    let (cp, classes, calendar) = calendar_section(b, names[0].p)?;
    let mut dictionary = BTreeMap::<i64, (usize, String)>::new();
    let mut class_records = Vec::new();
    let mut index = 0;
    for category in 0..4 {
        let count = if category == 0 {
            classes
        } else {
            before(b, names.get(index).ok_or(FAIL)?.p, 5000)
        };
        need(count > 0 && index + count <= names.len())?;
        for record in &names[index..index + count] {
            need(!dictionary.contains_key(&(record.id as i64)))?;
            dictionary.insert(record.id as i64, (category, record.name.trim().into()));
            if category == 0 {
                class_records.push(json!({"id":record.id.to_string(),"name":record.name.trim()}));
            }
        }
        index += count;
    }
    let mut h = Reader::new(b, 50);
    h.string()?;
    let mut dates = Reader::new(b, h.p + 7);
    let start = serial(dates.f64()?)?;
    let end = serial(dates.f64()?)?;
    need(start <= end && (crate::date(&end)? - crate::date(&start)?).num_days() <= 900)?;
    let duration = u32::from_le_bytes(b[11..15].try_into().unwrap());
    need((1..=240).contains(&duration))?;
    let (title, periods) = periods(b, cp, duration)?;
    let mut found = None;
    for record in &names[index..] {
        let n = before(b, record.p, 10000);
        if n > 0 {
            if let Ok(t) = timetable(b, record.p, n, periods.len()) {
                found = Some(t);
                break;
            }
        }
    }
    let (patterns, lessons) = found.ok_or(FAIL)?;
    let anchor = anchor(&patterns, &start)?;
    let hash = format!("{:x}", Sha256::digest(b));
    let (mut exceptions, mut exception_map) = (Vec::new(), BTreeMap::<String, Vec<String>>::new());
    for ex in calendar {
        let (mut d, last) = (text(&ex, "start").to_string(), text(&ex, "end").to_string());
        need((crate::date(&last)? - crate::date(&d)?).num_days() <= 900)?;
        while d <= last {
            let name = if text(&ex, "name").is_empty() {
                "Calendar exception"
            } else {
                text(&ex, "name")
            };
            exceptions.push(json!({"date":d,"name":name}));
            exception_map
                .entry(d.clone())
                .or_default()
                .push(if text(&ex, "name").is_empty() {
                    "Unlabelled exception".into()
                } else {
                    text(&ex, "name").into()
                });
            d = add_days(&d, 1);
        }
    }
    let mut datasets = serde_json::Map::new();
    for item in &class_records {
        datasets.insert(text(item, "id").into(), json!({"class":item,"events":[]}));
    }
    let (mut total, mut omitted) = (0, 0);
    let (mut lecturer_events, mut editor_events) = (Vec::new(), serde_json::Map::new());
    for lesson in lessons {
        let Some((3, subject)) = dictionary.get(&lesson.subject) else {
            continue;
        };
        let key = lesson.class_id.to_string();
        let class_name = datasets
            .get(&key)
            .map(|v| text(&v["class"], "name").to_string())
            .unwrap_or("Resource / activity".into());
        let mut groups = BTreeMap::<(u8, i64, i64), Vec<Slot>>::new();
        for slot in lesson.slots {
            if slot.day == 0 || slot.period == 0 || slot.flag != 0 {
                omitted += 1;
                continue;
            }
            groups
                .entry((slot.day, slot.lecturer, slot.room))
                .or_default()
                .push(slot);
        }
        for ((day, _, _), mut slots) in groups {
            slots.sort_by_key(|s| (s.period, s.id));
            let mut blocks: Vec<Vec<Slot>> = Vec::new();
            for slot in slots {
                if let Some(block) = blocks.last_mut() {
                    let prev = block.last().unwrap();
                    if slot.period == prev.period + 1
                        && periods[slot.period as usize - 1]
                            == periods[prev.period as usize - 1] + duration
                    {
                        block.push(slot);
                        continue;
                    }
                }
                blocks.push(vec![slot]);
            }
            for bit in &lesson.bits {
                let date = add_days(&anchor, bit * 7 + day as i64 - 1);
                if date < start || date > end {
                    continue;
                }
                for block in &blocks {
                    need(lecturer_events.len() < 200000)?;
                    let first = &block[0];
                    let last = block.last().unwrap();
                    let ids = block
                        .iter()
                        .map(|s| s.id.to_string())
                        .collect::<Vec<_>>()
                        .join(".");
                    let id = format!(
                        "{}-{}-{}-{ids}",
                        &hash[..24],
                        lesson.id,
                        date.replace('-', "")
                    );
                    let lookup = |id, cat| {
                        dictionary
                            .get(&id)
                            .filter(|(c, _)| *c == cat)
                            .map(|(_, n)| n.as_str())
                            .unwrap_or("")
                    };
                    let event = json!({"id":id,"date":date,"start":clock(periods[first.period as usize-1]),"end":clock(periods[last.period as usize-1]+duration),"subject":subject,"lecturer":lookup(first.lecturer,1),"room":lookup(first.room,2),"note":lesson.note.trim(),"exception":exception_map.get(&date).map(|a|a.join("; ")).unwrap_or_default(),"overlap":false});
                    if include_editor {
                        editor_events.insert(id,json!({"lessonId":lesson.id,"coupling":lesson.coupling,"noteOffset":lesson.note_offset,"noteEnd":lesson.note_end,"note":lesson.note,"slots":block}));
                    }
                    let mut le = event.clone();
                    le["className"] = json!(class_name);
                    lecturer_events.push(le);
                    if let Some(target) = datasets.get_mut(&key) {
                        target["events"].as_array_mut().unwrap().push(event);
                        total += 1;
                    }
                }
            }
        }
    }
    for dataset in datasets.values_mut() {
        let events = dataset["events"].as_array_mut().unwrap();
        events.sort_by(|a, b| {
            ["date", "start", "subject", "id"]
                .iter()
                .map(|k| text(a, k).cmp(text(b, k)))
                .find(|o| !o.is_eq())
                .unwrap_or(std::cmp::Ordering::Equal)
        });
        mark_overlaps(events);
        let n = events.len();
        let first = events
            .first()
            .map(|e| json!(text(e, "date")))
            .unwrap_or(Value::Null);
        let last = events
            .last()
            .map(|e| json!(text(e, "date")))
            .unwrap_or(Value::Null);
        dataset["class"]["eventCount"] = json!(n);
        dataset["class"]["firstDate"] = first;
        dataset["class"]["lastDate"] = last;
    }
    class_records = datasets.values().map(|v| v["class"].clone()).collect();
    class_records.sort_by(|a, b| text(a, "name").cmp(text(b, "name")));
    let lecturer_names = lecturer_events
        .iter()
        .map(|e| text(e, "lecturer").to_string())
        .filter(|s| !s.is_empty())
        .collect::<BTreeSet<_>>();
    let lecturers = lecturer_names
        .into_iter()
        .enumerate()
        .map(|(i, name)| json!({"id":(i+1).to_string(),"name":name}))
        .collect::<Vec<_>>();
    let staff = dictionary
        .iter()
        .filter(|(_, v)| v.0 == 1)
        .map(|(id, (_, name))| json!({"id":id.to_string(),"name":name}))
        .collect::<Vec<_>>();
    Ok(
        json!({"editor":{"events":editor_events,"periods":periods,"duration":duration,"staff":staff},"lecturerEvents":lecturer_events,"manifest":{"sourceHash":hash,"lecturers":lecturers,"title":title,"timezone":"Asia/Kuala_Lumpur","sourceRevision":"Your local file","filename":filename,"planningStart":start,"planningEnd":end,"reconstructed":true,"classes":class_records,"exceptions":exceptions},"datasets":datasets,"omitted":omitted,"total":total}),
    )
}
pub use crate::mark_overlaps;

pub fn edit(b: &[u8], event_id: &str, note: &str, day: u8, period: u8) -> R<Vec<u8>> {
    let decoded = decode(b, "Timetable.dav")?;
    let record = &decoded["editor"]["events"][event_id];
    need(!record.is_null())?;
    let slots: Vec<Slot> = serde_json::from_value(record["slots"].clone()).map_err(|_| FAIL)?;
    let periods = decoded["editor"]["periods"].as_array().ok_or(FAIL)?;
    need(
        (1..=7).contains(&day) && period >= 1 && period as usize + slots.len() - 1 <= periods.len(),
    )?;
    let moved = slots
        .iter()
        .enumerate()
        .any(|(i, s)| s.day != day || s.period as usize != period as usize + i);
    if moved && record["coupling"] != -1 {
        return Err(
            "Linked lessons must be moved together in DaVinci. You can edit the notes here.".into(),
        );
    }
    for i in 1..slots.len() {
        need(
            periods[period as usize + i - 1].as_u64().unwrap()
                == periods[period as usize + i - 2].as_u64().unwrap()
                    + decoded["editor"]["duration"].as_u64().unwrap(),
        )?;
    }
    let (encoded, _, errors) = encoding_rs::WINDOWS_1252.encode(note);
    if errors || encoded.len() > 255 {
        return Err("DAV notes support up to 255 Windows-1252 characters.".into());
    }
    let mut patched = b.to_vec();
    for (i, slot) in slots.iter().enumerate() {
        need(
            patched.get(slot.offset) == Some(&slot.day)
                && patched.get(slot.offset + 1) == Some(&slot.period),
        )?;
        patched[slot.offset] = day;
        patched[slot.offset + 1] = period + i as u8;
    }
    let from = record["noteOffset"].as_u64().ok_or(FAIL)? as usize;
    let to = record["noteEnd"].as_u64().ok_or(FAIL)? as usize;
    let mut out = Vec::new();
    out.extend_from_slice(&patched[..from]);
    out.extend_from_slice(&[6, encoded.len() as u8]);
    out.extend_from_slice(&encoded);
    out.extend_from_slice(&patched[to..]);
    decode(&out, "Timetable.dav")?;
    Ok(out)
}

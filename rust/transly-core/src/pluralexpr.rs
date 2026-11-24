//! `ext/plural-expr.ts`: правило множини мови, як воно записане в заголовку gettext: `plural=(n != 1)` чи
//! `plural=(n%10==1 && n%100!=11 ? 0 : …)`. Читається малим розбірником і ніколи не виконується як код (пакет мови — дані, не програма).

#[derive(Clone, Debug)]
enum Node {
    N,
    Num(f64),
    Un(char, Box<Node>),
    Bin(String, Box<Node>, Box<Node>),
    Cond(Box<Node>, Box<Node>, Box<Node>),
}

/// Функція для правила: номер форми множини за числом.
#[derive(Clone, Debug)]
pub struct PluralFn(Node);

impl PluralFn {
    pub fn call(&self, n: f64) -> usize {
        let r = run(&self.0, n.trunc().abs()).trunc();
        if r.is_finite() && r >= 0.0 { r as usize } else { 0 }
    }
}

fn tokens(src: &str) -> Option<Vec<String>> {
    let cs: Vec<char> = src.chars().collect();
    let mut out = Vec::new();
    let mut i = 0;
    while i < cs.len() {
        while i < cs.len() && crate::js::is_space(cs[i]) {
            i += 1;
        }
        if i >= cs.len() {
            break;
        }
        let c = cs[i];
        if c.is_ascii_digit() {
            let s = i;
            while i < cs.len() && cs[i].is_ascii_digit() {
                i += 1;
            }
            out.push(cs[s..i].iter().collect());
        } else if c == 'n' {
            out.push("n".into());
            i += 1;
        } else {
            let two: String = cs[i..(i + 2).min(cs.len())].iter().collect();
            if matches!(two.as_str(), "&&" | "||" | "==" | "!=" | "<=" | ">=") {
                out.push(two);
                i += 2;
            } else if "-+*/%<>!?:()".contains(c) {
                out.push(c.to_string());
                i += 1;
            } else {
                return None;
            }
        }
    }
    Some(out)
}

fn prec(op: &str) -> Option<u8> {
    Some(match op {
        "||" => 1,
        "&&" => 2,
        "==" | "!=" => 3,
        "<" | ">" | "<=" | ">=" => 4,
        "+" | "-" => 5,
        "*" | "/" | "%" => 6,
        _ => return None,
    })
}

struct P<'a> {
    tk: &'a [String],
    i: usize,
}
impl P<'_> {
    fn next(&mut self) -> Option<&String> {
        let t = self.tk.get(self.i);
        self.i += 1;
        t
    }
    fn primary(&mut self) -> Option<Node> {
        let t = self.next()?.clone();
        if t == "n" {
            return Some(Node::N);
        }
        if t.bytes().all(|b| b.is_ascii_digit()) {
            return Some(Node::Num(t.parse().unwrap_or(0.0)));
        }
        if t == "(" {
            let e = self.expr()?;
            return if self.next().map(String::as_str) == Some(")") { Some(e) } else { None };
        }
        if t == "!" || t == "-" {
            let a = self.primary()?;
            return Some(Node::Un(t.chars().next().unwrap(), Box::new(a)));
        }
        None
    }
    fn binary(&mut self, min: u8) -> Option<Node> {
        let mut a = self.primary();
        while let Some(left) = a.clone() {
            let Some(op) = self.tk.get(self.i).cloned() else { break };
            let Some(p) = prec(&op) else { break };
            if p < min {
                break;
            }
            self.i += 1;
            let b = self.binary(p + 1)?;
            a = Some(Node::Bin(op, Box::new(left), Box::new(b)));
        }
        a
    }
    fn expr(&mut self) -> Option<Node> {
        let c = self.binary(1)?;
        if self.tk.get(self.i).map(String::as_str) != Some("?") {
            return Some(c);
        }
        self.i += 1;
        let a = self.expr()?;
        if self.next().map(String::as_str) != Some(":") {
            return None;
        }
        let b = self.expr()?;
        Some(Node::Cond(Box::new(c), Box::new(a), Box::new(b)))
    }
}

fn run(e: &Node, n: f64) -> f64 {
    let b = |x: bool| if x { 1.0 } else { 0.0 };
    match e {
        Node::N => n,
        Node::Num(v) => *v,
        Node::Un(op, a) => {
            let v = run(a, n);
            if *op == '!' { b(v == 0.0) } else { -v }
        }
        Node::Cond(c, a, d) => {
            if run(c, n) != 0.0 { run(a, n) } else { run(d, n) }
        }
        Node::Bin(op, x, y) => {
            let (a, c) = (run(x, n), run(y, n));
            match op.as_str() {
                "||" => b(a != 0.0 || c != 0.0),
                "&&" => b(a != 0.0 && c != 0.0),
                "==" => b(a == c),
                "!=" => b(a != c),
                "<" => b(a < c),
                ">" => b(a > c),
                "<=" => b(a <= c),
                ">=" => b(a >= c),
                "+" => a + c,
                "-" => a - c,
                "*" => a * c,
                "/" => if c == 0.0 { 0.0 } else { (a / c).trunc() },
                _ => if c == 0.0 { 0.0 } else { a % c },
            }
        }
    }
}

/// Функція для правила, або None, коли правило записане не в підтримуваній формі.
pub fn plural_fn(expr: &str) -> Option<PluralFn> {
    if crate::js::len16(expr) > 300 {
        return None;
    }
    let trimmed = match expr.rfind(';') {
        Some(i) if crate::js::trim(&expr[i + 1..]).is_empty() => &expr[..i],
        _ => expr,
    };
    let tk = tokens(trimmed)?;
    let mut p = P { tk: &tk, i: 0 };
    let tree = p.expr()?;
    if p.i != tk.len() {
        return None;
    }
    Some(PluralFn(tree))
}

/// Правила поширених мов (коли пакет нічого не каже чи каже нечитане).
pub fn known_plural(code: &str) -> Option<&'static str> {
    const UK: &str = "n%10==1 && n%100!=11 ? 0 : n%10>=2 && n%10<=4 && (n%100<10 || n%100>=20) ? 1 : 2";
    Some(match code {
        "uk" | "ru" | "be" => UK,
        "pl" => "n==1 ? 0 : n%10>=2 && n%10<=4 && (n%100<10 || n%100>=20) ? 1 : 2",
        "cs" | "sk" => "(n==1) ? 0 : (n>=2 && n<=4) ? 1 : 2",
        "en" | "de" | "nl" | "es" | "it" | "pt" | "sv" | "da" | "nb" | "fi" => "n != 1",
        "tr" => "n > 1",
        "fr" => "n > 1",
        "ja" | "zh" | "ko" | "vi" | "th" | "id" => "0",
        _ => return None,
    })
}

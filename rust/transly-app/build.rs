fn main() {
    // піктограма й опис у самому .exe (лише для Windows-збірки)
    if std::env::var("CARGO_CFG_TARGET_OS").is_ok_and(|os| os == "windows") {
        let mut res = winresource::WindowsResource::new();
        res.set_icon("assets/icon.ico");
        res.set("ProductName", "Transly");
        res.set("FileDescription", "Transly: робоче місце перекладача ігор");
        if let Err(e) = res.compile() {
            println!("cargo:warning=не вдалося вбудувати піктограму: {e}");
        }
    }
}

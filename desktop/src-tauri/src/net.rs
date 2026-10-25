use std::net::IpAddr;

pub(crate) const PORT: u16 = 7777;
pub(crate) const CODE_TTL: u64 = 30;

pub(crate) fn new_code() -> String {
    format!("{:06}", uuid::Uuid::new_v4().as_u128() % 1_000_000)
}

// pick the wifi ip and skip vpn / virtual adapters
pub(crate) fn local_ip() -> String {
    let ips: Vec<IpAddr> = local_ip_address::list_afinet_netifas()
        .unwrap_or_default()
        .into_iter()
        .map(|(_, ip)| ip)
        .filter(|ip| ip.is_ipv4() && !ip.is_loopback())
        .collect();

    let pick = ips
        .iter()
        .find(|ip| ip.to_string().starts_with("192.168."))
        .or_else(|| {
            ips.iter().find(|ip| {
                let s = ip.to_string();
                s.starts_with("172.")
                    && s.split('.')
                        .nth(1)
                        .and_then(|n| n.parse::<u8>().ok())
                        .map_or(false, |n| (16..=31).contains(&n))
            })
        })
        .or_else(|| ips.first());

    pick.map(|ip| ip.to_string())
        .unwrap_or_else(|| "127.0.0.1".into())
}

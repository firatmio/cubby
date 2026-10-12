//! Modem üzerinden doğrudan bağlantı: UPnP ile port açma + CGNAT tespiti.

use std::net::{IpAddr, Ipv4Addr, SocketAddr, SocketAddrV4};
use std::time::Duration;

use igd_next::aio::Gateway;
use igd_next::aio::tokio::{Tokio, search_gateway};
use igd_next::{AddAnyPortError, AddPortError, PortMappingProtocol, SearchOptions};

/// Eşlemenin modemde kalma süresi; `RENEW_EVERY`'de bir yenilenir.
pub const LEASE_SECS: u32 = 60 * 60;
pub const RENEW_EVERY: Duration = Duration::from_secs(30 * 60);

const DESCRIPTION: &str = "Cubby";
const PUBLIC_IP_URLS: [&str; 2] = ["https://api.ipify.org", "https://icanhazip.com"];

/// Kullanıcıya gösterilecek, sade dilde neden.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum DirectError {
    /// Modem UPnP'ye yanıt vermedi (kapalı ya da desteklemiyor).
    NoGateway,
    /// Modem isteği reddetti.
    Refused,
    /// İnternet sağlayıcı ortak IP kullanıyor; içeriden port açmak işe yaramaz.
    Cgnat,
    Other(String),
}

impl DirectError {
    pub fn message(&self) -> String {
        match self {
            Self::NoGateway => {
                tx!(
                    "Modemin otomatik port açmayı (UPnP) desteklemiyor ya da kapalı.",
                    "Your router doesn't support automatic port opening (UPnP), or it's turned off."
                )
            }
            Self::Refused => tx!(
                "Modemin port açma isteğini reddetti.",
                "Your router refused the port-opening request."
            ),
            Self::Cgnat => {
                tx!(
                    "İnternet sağlayıcın ortak IP kullanıyor (CGNAT); doğrudan bağlantı mümkün değil.",
                    "Your internet provider uses a shared IP (CGNAT); a direct connection isn't possible."
                )
            }
            Self::Other(e) => tx!(
                "Doğrudan bağlantı kurulamadı: {e}",
                "Couldn't set up a direct connection: {e}"
            ),
        }
    }
}

/// Modemde açılmış bir port.
pub struct Mapping {
    gateway: Gateway<Tokio>,
    local: SocketAddrV4,
    pub external_port: u16,
    pub public: SocketAddrV4,
}

/// Özel, CGNAT (100.64/10) ya da yönlendirilemeyen adres mi? Modemin "dış" IP'si böyleyse arada bir NAT daha var.
pub fn is_shared_or_private(ip: Ipv4Addr) -> bool {
    let [a, b, ..] = ip.octets();
    ip.is_private()
        || ip.is_loopback()
        || ip.is_link_local()
        || ip.is_unspecified()
        || (a == 100 && (64..128).contains(&b))
}

/// Modemin bildirdiği dış IP ile internetten görünen IP aynı ve gerçek bir adres mi?
pub fn classify(
    gateway_ip: Ipv4Addr,
    public_ip: Option<Ipv4Addr>,
) -> Result<Ipv4Addr, DirectError> {
    if is_shared_or_private(gateway_ip) {
        return Err(DirectError::Cgnat);
    }
    match public_ip {
        Some(p) if p != gateway_ip => Err(DirectError::Cgnat),
        _ => Ok(gateway_ip),
    }
}

async fn public_ip(http: &reqwest::Client) -> Option<Ipv4Addr> {
    for url in PUBLIC_IP_URLS {
        let Ok(res) = http.get(url).timeout(Duration::from_secs(5)).send().await else {
            continue;
        };
        if let Ok(text) = res.text().await
            && let Ok(ip) = text.trim().parse()
        {
            return Some(ip);
        }
    }
    None
}

async fn gateway() -> Result<Gateway<Tokio>, DirectError> {
    let mut options = SearchOptions::default();
    options.timeout = Some(Duration::from_secs(4));
    search_gateway(options)
        .await
        .map_err(|_| DirectError::NoGateway)
}

fn add_port_error(e: AddPortError) -> DirectError {
    match e {
        AddPortError::ActionNotAuthorized | AddPortError::PortInUse => DirectError::Refused,
        e => DirectError::Other(e.to_string()),
    }
}

async fn add(
    gw: &Gateway<Tokio>,
    local: SocketAddrV4,
    external_port: u16,
) -> Result<(), AddPortError> {
    let addr = SocketAddr::V4(local);
    match gw
        .add_port(
            PortMappingProtocol::TCP,
            external_port,
            addr,
            LEASE_SECS,
            DESCRIPTION,
        )
        .await
    {
        // Bazı modemler yalnız süresiz eşleme kabul eder.
        Err(AddPortError::OnlyPermanentLeasesSupported) => {
            gw.add_port(
                PortMappingProtocol::TCP,
                external_port,
                addr,
                0,
                DESCRIPTION,
            )
            .await
        }
        r => r,
    }
}

/// Sunucu portunu modemde açar. Aynı dış port doluysa modemin verdiği başka bir porta düşer.
pub async fn open(
    http: &reqwest::Client,
    local_ip: Ipv4Addr,
    port: u16,
) -> Result<Mapping, DirectError> {
    let gw = gateway().await?;
    let gateway_ip = match gw.get_external_ip().await {
        Ok(IpAddr::V4(ip)) => ip,
        Ok(IpAddr::V6(_)) => {
            return Err(DirectError::Other(tx!(
                "modem IPv6 dış adres bildirdi",
                "the router reported an IPv6 external address"
            )));
        }
        Err(e) => return Err(DirectError::Other(e.to_string())),
    };
    let ip = classify(gateway_ip, public_ip(http).await)?;

    let local = SocketAddrV4::new(local_ip, port);
    let external_port = match add(&gw, local, port).await {
        Ok(()) => port,
        Err(AddPortError::PortInUse) => gw
            .add_any_port(
                PortMappingProtocol::TCP,
                SocketAddr::V4(local),
                LEASE_SECS,
                DESCRIPTION,
            )
            .await
            .map_err(|e| match e {
                AddAnyPortError::ActionNotAuthorized | AddAnyPortError::NoPortsAvailable => {
                    DirectError::Refused
                }
                e => DirectError::Other(e.to_string()),
            })?,
        Err(e) => return Err(add_port_error(e)),
    };

    Ok(Mapping {
        gateway: gw,
        local,
        external_port,
        public: SocketAddrV4::new(ip, external_port),
    })
}

impl Mapping {
    pub async fn renew(&self) -> Result<(), DirectError> {
        add(&self.gateway, self.local, self.external_port)
            .await
            .map_err(add_port_error)
    }

    pub async fn close(self) {
        let _ = self
            .gateway
            .remove_port(PortMappingProtocol::TCP, self.external_port)
            .await;
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn ip(s: &str) -> Ipv4Addr {
        s.parse().unwrap()
    }

    #[test]
    fn shared_and_private_ranges() {
        for s in [
            "10.0.0.1",
            "172.16.5.4",
            "192.168.1.1",
            "100.64.0.1",
            "100.127.255.254",
            "127.0.0.1",
            "169.254.1.1",
        ] {
            assert!(is_shared_or_private(ip(s)), "{s}");
        }
        for s in ["188.119.44.224", "100.63.255.255", "100.128.0.1", "8.8.8.8"] {
            assert!(!is_shared_or_private(ip(s)), "{s}");
        }
    }

    #[test]
    fn classify_detects_cgnat() {
        assert_eq!(
            classify(ip("100.70.1.2"), Some(ip("188.119.44.224"))),
            Err(DirectError::Cgnat)
        );
        assert_eq!(
            classify(ip("88.1.2.3"), Some(ip("188.119.44.224"))),
            Err(DirectError::Cgnat)
        );
        assert_eq!(
            classify(ip("188.119.44.224"), Some(ip("188.119.44.224"))),
            Ok(ip("188.119.44.224"))
        );
        // Dış IP öğrenilemediyse modemin söylediğine güvenilir.
        assert_eq!(
            classify(ip("188.119.44.224"), None),
            Ok(ip("188.119.44.224"))
        );
    }

    /// Bu makinenin modemiyle gerçek deneme: port açar, gösterir, kapatır.
    #[tokio::test]
    #[ignore]
    async fn live_upnp() {
        let http = reqwest::Client::new();
        let local = match local_ip_address::local_ip().unwrap() {
            IpAddr::V4(v4) => v4,
            IpAddr::V6(_) => panic!("IPv4 yok"),
        };
        match open(&http, local, 25599).await {
            Ok(m) => {
                println!("açıldı: {}", m.public);
                m.renew().await.unwrap();
                m.close().await;
            }
            Err(e) => println!("olmadı: {}", e.message()),
        }
    }
}

use serde::Serialize;
use sysinfo::{Pid, ProcessRefreshKind, ProcessesToUpdate, System};

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProcessStats {
    /// Tüm çekirdeklere oranla yüzde (0–100).
    pub cpu: f32,
    pub mem_mb: u64,
}

/// Tek bir PID'i ölçer. CPU yüzdesi iki ölçüm arasındaki farktan hesaplandığı için
/// aynı nesne üzerinde periyodik çağrılmalı (ilk ölçüm 0 döner).
pub struct ProcessSampler {
    sys: System,
    pid: Pid,
    cores: f32,
}

impl ProcessSampler {
    pub fn new(pid: u32) -> Self {
        Self {
            sys: System::new(),
            pid: Pid::from_u32(pid),
            cores: std::thread::available_parallelism().map_or(1, |n| n.get()) as f32,
        }
    }

    pub fn sample(&mut self) -> Option<ProcessStats> {
        self.sys.refresh_processes_specifics(
            ProcessesToUpdate::Some(&[self.pid]),
            true,
            ProcessRefreshKind::nothing().with_cpu().with_memory(),
        );
        let p = self.sys.process(self.pid)?;
        Some(ProcessStats {
            cpu: (p.cpu_usage() / self.cores).min(100.0),
            mem_mb: p.memory() / 1024 / 1024,
        })
    }
}

pub fn total_memory_mb() -> u64 {
    let mut sys = System::new();
    sys.refresh_memory();
    sys.total_memory() / 1024 / 1024
}

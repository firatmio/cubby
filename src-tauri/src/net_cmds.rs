use std::sync::Arc;

use tauri::{AppHandle, Manager, State};

use crate::commands::AppState;
use crate::error::AppResult;
use crate::net::{ConnectionView, NetManager};
use crate::paths;

type Net<'a> = State<'a, Arc<NetManager>>;

#[tauri::command]
pub async fn connection_status(
    app: AppHandle,
    net: Net<'_>,
    id: String,
) -> AppResult<ConnectionView> {
    paths::validate_id(&id)?;
    net.view(&app, &id).await
}

#[tauri::command]
pub async fn set_internet(
    app: AppHandle,
    net: Net<'_>,
    id: String,
    on: bool,
) -> AppResult<ConnectionView> {
    paths::validate_id(&id)?;
    // İnternetten gelenler Cubby'den geçmez, adları korunamaz: premium olmayan dünyada beyaz liste.
    if on {
        crate::world_cmds::whitelist_for_internet(&app, &app.state::<AppState>(), &id).await?;
    }
    net.inner().set_internet(&app, &id, on).await
}

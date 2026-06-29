// Copyright 2019-2023 Tauri Programme within The Commons Conservancy
// SPDX-License-Identifier: Apache-2.0
// SPDX-License-Identifier: MIT

use tauri::{command, ipc::Channel, plugin::PermissionState, AppHandle, Runtime, State};

use crate::{Notification, NotificationData, ReceivedNotification, Result};

#[command]
pub(crate) async fn is_permission_granted<R: Runtime>(
    _app: AppHandle<R>,
    notification: State<'_, Notification<R>>,
) -> Result<Option<bool>> {
    let state = notification.permission_state()?;
    match state {
        PermissionState::Granted => Ok(Some(true)),
        PermissionState::Denied => Ok(Some(false)),
        PermissionState::Prompt | PermissionState::PromptWithRationale => Ok(None),
    }
}

#[command]
pub(crate) async fn request_permission<R: Runtime>(
    _app: AppHandle<R>,
    notification: State<'_, Notification<R>>,
) -> Result<PermissionState> {
    notification.request_permission()
}

#[command]
pub(crate) async fn notify<R: Runtime>(
    _app: AppHandle<R>,
    notification: State<'_, Notification<R>>,
    options: NotificationData,
) -> Result<()> {
    let mut builder = notification.builder();
    builder.data = options;
    builder.show()
}

#[command]
pub(crate) async fn register_action_types<R: Runtime>(
    _app: AppHandle<R>,
    notification: State<'_, Notification<R>>,
    types: Vec<crate::ActionType>,
) -> Result<()> {
    notification.register_action_types(types)
}

#[command]
pub(crate) async fn register_listener<R: Runtime>(
    _app: AppHandle<R>,
    notification: State<'_, Notification<R>>,
    event: String,
    handler: Channel<ReceivedNotification>,
) -> Result<()> {
    notification.register_listener(event, handler)
}

#[command]
pub(crate) async fn remove_listener<R: Runtime>(
    _app: AppHandle<R>,
    notification: State<'_, Notification<R>>,
    event: String,
    channel_id: u32,
) -> Result<()> {
    notification.remove_listener(&event, channel_id)
}

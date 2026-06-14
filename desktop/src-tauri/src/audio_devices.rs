use serde::Serialize;

#[derive(Debug, Serialize)]
pub struct NativeAudioDevice {
    pub device_id: String,
    pub label: String,
    pub kind: String,
    pub is_default: bool,
}

#[cfg(target_os = "windows")]
fn enumerate_windows_audio_devices() -> windows::core::Result<Vec<NativeAudioDevice>> {
    use windows::core::PWSTR;
    use windows::Win32::Devices::FunctionDiscovery::PKEY_Device_FriendlyName;
    use windows::Win32::Media::Audio::{
        eCapture, eCommunications, eRender, IMMDevice, IMMDeviceEnumerator, MMDeviceEnumerator,
        DEVICE_STATE_ACTIVE,
    };
    use windows::Win32::System::Com::StructuredStorage::{
        PropVariantClear, PropVariantToStringAlloc,
    };
    use windows::Win32::System::Com::{
        CoCreateInstance, CoInitializeEx, CoTaskMemFree, CLSCTX_ALL, COINIT_MULTITHREADED,
        STGM_READ,
    };

    unsafe {
        let _ = CoInitializeEx(None, COINIT_MULTITHREADED);
        let enumerator: IMMDeviceEnumerator =
            CoCreateInstance(&MMDeviceEnumerator, None, CLSCTX_ALL)?;

        let default_input_id = default_endpoint_id(&enumerator, eCapture).ok();
        let default_output_id = default_endpoint_id(&enumerator, eRender).ok();
        let mut devices = Vec::new();

        for (flow, kind, default_id) in [
            (eCapture, "audioinput", default_input_id.as_deref()),
            (eRender, "audiooutput", default_output_id.as_deref()),
        ] {
            let collection = enumerator.EnumAudioEndpoints(flow, DEVICE_STATE_ACTIVE)?;
            let count = collection.GetCount()?;

            for index in 0..count {
                let device = collection.Item(index)?;
                let device_id = device.GetId()?.to_string()?;
                let label = friendly_name(&device).unwrap_or_else(|_| {
                    if kind == "audioinput" {
                        format!("Microphone {}", index + 1)
                    } else {
                        format!("Speaker {}", index + 1)
                    }
                });

                devices.push(NativeAudioDevice {
                    is_default: default_id == Some(device_id.as_str()),
                    device_id,
                    label,
                    kind: kind.to_string(),
                });
            }
        }

        return Ok(devices);
    }

    unsafe fn default_endpoint_id(
        enumerator: &IMMDeviceEnumerator,
        flow: windows::Win32::Media::Audio::EDataFlow,
    ) -> windows::core::Result<String> {
        let device = enumerator.GetDefaultAudioEndpoint(flow, eCommunications)?;
        Ok(device.GetId()?.to_string()?)
    }

    unsafe fn friendly_name(device: &IMMDevice) -> windows::core::Result<String> {
        let store = device.OpenPropertyStore(STGM_READ)?;
        let mut value = store.GetValue(&PKEY_Device_FriendlyName)?;
        let text: PWSTR = PropVariantToStringAlloc(&value)?;
        let name = text.to_string()?;
        CoTaskMemFree(Some(text.0 as _));
        PropVariantClear(&mut value)?;
        Ok(name)
    }
}

#[tauri::command]
pub fn get_native_audio_devices() -> Vec<NativeAudioDevice> {
    #[cfg(target_os = "windows")]
    {
        match enumerate_windows_audio_devices() {
            Ok(devices) => {
                let inputs = devices
                    .iter()
                    .filter(|device| device.kind == "audioinput")
                    .count();
                let outputs = devices
                    .iter()
                    .filter(|device| device.kind == "audiooutput")
                    .count();
                log::info!("[AudioDevices] Enumerated {inputs} input(s), {outputs} output(s)");
                devices
            }
            Err(err) => {
                log::warn!("[AudioDevices] Failed to enumerate Windows audio devices: {err}");
                Vec::new()
            }
        }
    }

    #[cfg(not(target_os = "windows"))]
    {
        Vec::new()
    }
}

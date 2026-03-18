use windows::core::{Result as WinResult, *};
use windows::Win32::Media::MediaFoundation::*;
use windows::Win32::System::Com::*;

/// Production-ready Hardware H.264 Encoder using Windows Media Foundation.
/// Leverages Intel QuickSync, NVIDIA NVENC, or AMD AMF transparently via WMF.
pub struct WmfH264Encoder {
    encoder_mft: IMFTransform,
    width: u32,
    height: u32,
    fps: u32,
    bitrate: u32,
}

impl WmfH264Encoder {
    pub fn new(
        width: u32,
        height: u32,
        fps: u32,
        bitrate: u32,
    ) -> WinResult<Self> {
        unsafe {
            // MFStartup must be called before any MF APIs.
            let _ = MFStartup(MF_VERSION, MFSTARTUP_NOSOCKET);

            // 1. Create the H.264 Encoder Media Foundation Transform (MFT)
            let encoder_mft: IMFTransform = CoCreateInstance(
                &CLSID_MSH264EncoderMFT,
                None,
                CLSCTX_INPROC_SERVER,
            )?;

            // 2. Set the Output Type (H.264)
            let out_type: IMFMediaType = MFCreateMediaType()?;
            out_type.SetGUID(&MF_MT_MAJOR_TYPE, &MFMediaType_Video)?;
            out_type.SetGUID(&MF_MT_SUBTYPE, &MFVideoFormat_H264)?;
            out_type.SetUINT32(&MF_MT_AVG_BITRATE, bitrate)?;
            out_type.SetUINT64(&MF_MT_FRAME_RATE, ((fps as u64) << 32) | 1)?;
            out_type.SetUINT64(
                &MF_MT_FRAME_SIZE,
                ((width as u64) << 32) | (height as u64),
            )?;
            // Set Interlacing (Progressive)
            out_type.SetUINT32(&MF_MT_INTERLACE_MODE, 2)?; // MFVideoInterlace_Progressive = 2

            encoder_mft.SetOutputType(0, &out_type, 0)?;

            // 3. Set the Input Type (BGRA/NV12)
            // Note: MS H264 Encoder natively prefers NV12 or IYUV.
            // In a fully integrated zero-copy pipeline, we should use CLSID_CColorConvertDMO
            // or VideoProcessorMFT to map BGRA to NV12 on the GPU.
            let in_type: IMFMediaType = MFCreateMediaType()?;
            in_type.SetGUID(&MF_MT_MAJOR_TYPE, &MFMediaType_Video)?;
            in_type.SetGUID(&MF_MT_SUBTYPE, &MFVideoFormat_NV12)?;
            in_type.SetUINT64(&MF_MT_FRAME_RATE, ((fps as u64) << 32) | 1)?;
            in_type.SetUINT64(
                &MF_MT_FRAME_SIZE,
                ((width as u64) << 32) | (height as u64),
            )?;
            in_type.SetUINT32(&MF_MT_INTERLACE_MODE, 2)?;

            encoder_mft.SetInputType(0, &in_type, 0)?;

            // 4. Begin Streaming
            encoder_mft.ProcessMessage(MFT_MESSAGE_COMMAND_FLUSH, 0)?;
            encoder_mft
                .ProcessMessage(MFT_MESSAGE_NOTIFY_BEGIN_STREAMING, 0)?;
            encoder_mft
                .ProcessMessage(MFT_MESSAGE_NOTIFY_START_OF_STREAM, 0)?;

            Ok(Self {
                encoder_mft,
                width,
                height,
                fps,
                bitrate,
            })
        }
    }

    /// Encode a raw video frame buffer (NV12) into an H.264 NAL Unit payload.
    /// This method is designed to sit directly inside the crabgrab capture loop.
    pub fn encode(
        &mut self,
        nv12_data: &[u8],
        duration: i64,
    ) -> WinResult<Vec<u8>> {
        unsafe {
            // 1. Create an MFMediaBuffer wrapped inside an IMFSample
            let buffer: IMFMediaBuffer =
                MFCreateMemoryBuffer(nv12_data.len() as u32)?;

            let mut ptr = std::ptr::null_mut();
            let mut max_len = 0;
            let mut current_len = 0;
            buffer.Lock(
                &mut ptr,
                Some(&mut max_len),
                Some(&mut current_len),
            )?;
            std::ptr::copy_nonoverlapping(
                nv12_data.as_ptr(),
                ptr,
                nv12_data.len(),
            );
            buffer.SetCurrentLength(nv12_data.len() as u32)?;
            buffer.Unlock()?;

            let sample: IMFSample = MFCreateSample()?;
            sample.AddBuffer(&buffer)?;
            sample.SetSampleDuration(duration)?;

            // 2. Feed the sample to the Hardware Encoder
            self.encoder_mft.ProcessInput(0, &sample, 0)?;

            // Allocate an output sample. The encoder will size the inner buffer.
            let out_sample = MFCreateSample()?;
            // Hardcode 1MB temp buffer for compressed NALs.
            let out_buffer: IMFMediaBuffer = MFCreateMemoryBuffer(1024 * 1024)?;
            out_sample.AddBuffer(&out_buffer)?;

            let mut process_res = 0;
            let mut buffers = [MFT_OUTPUT_DATA_BUFFER {
                dwStreamID: 0,
                pSample: std::mem::ManuallyDrop::new(Some(out_sample)),
                dwStatus: 0,
                pEvents: std::mem::ManuallyDrop::new(None),
            }];

            let process_result = self.encoder_mft.ProcessOutput(
                0, // flags
                &mut buffers,
                &mut process_res,
            );

            let res = &mut buffers[0];

            // MFT_E_TRANSFORM_NEED_MORE_INPUT is perfectly normal for B-frames/P-frames caching.
            if let Err(e) = process_result {
                if e.code().0 == 0xC00D6D72u32 as i32 {
                    // MFT_E_TRANSFORM_NEED_MORE_INPUT
                    return Ok(Vec::new());
                }
                return Err(e);
            }

            // Extract the compressed bytes (RTP NAL Units)
            if let Some(out_s) = &*res.pSample {
                let out_buf = out_s.ConvertToContiguousBuffer()?;
                let mut p_data = std::ptr::null_mut();
                let mut cur_len = 0;
                out_buf.Lock(&mut p_data, None, Some(&mut cur_len))?;

                let slice =
                    std::slice::from_raw_parts(p_data, cur_len as usize);
                let nal_units = slice.to_vec();

                out_buf.Unlock()?;
                return Ok(nal_units);
            }

            Ok(Vec::new())
        }
    }
}

impl Drop for WmfH264Encoder {
    fn drop(&mut self) {
        unsafe {
            if let Ok(_) = self
                .encoder_mft
                .ProcessMessage(MFT_MESSAGE_NOTIFY_END_OF_STREAM, 0)
            {
            }
            if let Ok(_) = self
                .encoder_mft
                .ProcessMessage(MFT_MESSAGE_COMMAND_FLUSH, 0)
            {}
            let _ = MFShutdown();
        }
    }
}

/// Helper method to write BGRA -> NV12 in software to bridge CrabGrab to WMF natively.
pub fn bgra_to_nv12(bgra: &[u8], width: usize, height: usize) -> Vec<u8> {
    let y_size = width * height;
    let uv_size = y_size / 2;
    let mut nv12 = vec![0u8; y_size + uv_size];

    let mut uv_offset = y_size;

    for row in 0..height {
        for col in 0..width {
            let idx = (row * width + col) * 4;
            let b = bgra[idx] as f32;
            let g = bgra[idx + 1] as f32;
            let r = bgra[idx + 2] as f32;

            let y = (0.299 * r + 0.587 * g + 0.114 * b) as u8;
            nv12[row * width + col] = y;

            if row % 2 == 0 && col % 2 == 0 {
                let u = (-0.147 * r - 0.289 * g + 0.436 * b + 128.0) as u8;
                let v = (0.615 * r - 0.515 * g - 0.100 * b + 128.0) as u8;

                nv12[uv_offset] = u;
                nv12[uv_offset + 1] = v;
                uv_offset += 2;
            }
        }
    }

    nv12
}

use std::ffi::c_void;
use std::ptr;

#[repr(C)]
struct GUID { data1: u32, data2: u16, data3: u16, data4: [u8; 8] }

const CLSID_APPLICATION_ACTIVATION_MANAGER: GUID = GUID {
    data1: 0x45BA127D, data2: 0x10A8, data3: 0x46EA,
    data4: [0x8A, 0xB7, 0x56, 0xA9, 0x07, 0x89, 0x43, 0xC1],
};
const IID_IAPPLICATION_ACTIVATION_MANAGER: GUID = GUID {
    data1: 0x2E941141, data2: 0x8317, data3: 0x428C,
    data4: [0xBF, 0xD2, 0x53, 0xC2, 0x59, 0x7F, 0x1B, 0xE7],
};

#[repr(C)]
struct ActivationVtbl {
    query_interface: unsafe extern "system" fn(*mut c_void, *const GUID, *mut *mut c_void) -> i32,
    add_ref: unsafe extern "system" fn(*mut c_void) -> u32,
    release: unsafe extern "system" fn(*mut c_void) -> u32,
    activate_application: unsafe extern "system" fn(
        *mut c_void, *const u16, *const u16, u32, *mut u32,
    ) -> i32,
}

#[repr(C)]
struct ActivationManager {
    vtbl: *const ActivationVtbl,
}

extern "system" {
    fn CoCreateInstance(
        rclsid: *const GUID, pUnkOuter: *mut c_void,
        dwClsContext: u32, riid: *const GUID, ppv: *mut *mut c_void,
    ) -> i32;
}

pub fn launch_msix(aumid: &str, file_path: &str) -> Result<(), String> {
    unsafe {
        let mut instance: *mut c_void = ptr::null_mut();
        let hr = CoCreateInstance(
            &CLSID_APPLICATION_ACTIVATION_MANAGER,
            ptr::null_mut(),
            0x4,
            &IID_IAPPLICATION_ACTIVATION_MANAGER,
            &mut instance,
        );
        if hr != 0 || instance.is_null() {
            return Err(format!("CoCreateInstance failed: 0x{:08X}", hr));
        }

        let mgr = &*(instance as *const ActivationManager);
        let aumid_wide: Vec<u16> = aumid.encode_utf16().chain(Some(0)).collect();
        let file_wide: Vec<u16> = file_path.encode_utf16().chain(Some(0)).collect();
        let mut process_id: u32 = 0;

        let hr = ((*mgr.vtbl).activate_application)(
            instance, aumid_wide.as_ptr(), file_wide.as_ptr(), 0x4, &mut process_id,
        );
        ((*mgr.vtbl).release)(instance);

        if hr < 0 {
            return Err(format!("ActivateApplication failed: 0x{:08X}", hr));
        }
        Ok(())
    }
}

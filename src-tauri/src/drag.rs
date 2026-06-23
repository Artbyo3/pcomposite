use std::ffi::c_void;
use std::ptr;
use std::sync::OnceLock;

const ZIP_CONTENT: &[u8] = include_bytes!("../../public/pcomposite_bridge.zip");

const CARD_W: i32 = 200;
const CARD_H: i32 = 96;
const BG_COLOR: u32 = 0x00212121;
const BORDER_COLOR: u32 = 0x0043A047;
const TEXT_COLOR: u32 = 0x00FFFFFF;
const SUB_COLOR: u32 = 0x00969696;

struct CursorHandle(*mut c_void);
unsafe impl Send for CursorHandle {}
unsafe impl Sync for CursorHandle {}

static DRAG_CURSOR: OnceLock<CursorHandle> = OnceLock::new();

    pub fn drag_addon(hwnd: *mut c_void) -> Result<(), String> {
    let temp_path = std::env::temp_dir().join("pcomposite_bridge.zip");
    std::fs::write(&temp_path, ZIP_CONTENT).map_err(|e| e.to_string())?;

    let wide: Vec<u16> = temp_path
        .to_string_lossy()
        .encode_utf16()
        .chain(std::iter::once(0))
        .chain(std::iter::once(0))
        .collect();

    unsafe {
        let hr_init = OleInitialize(ptr::null());
        if hr_init < 0 {
            return Err(format!("OleInitialize failed: 0x{:x}", hr_init));
        }

        let fp = Box::into_raw(Box::new(FilePath { data: wide }));
        let data_obj = Box::into_raw(Box::new(DataObject::new(fp as *const FilePath)));
        let drop_src = Box::into_raw(Box::new(DropSource {
            vtbl: &DROP_SOURCE_VTBL,
            ref_count: 1,
            hwnd: hwnd as *mut c_void,
        }));

        if set_drag_image(data_obj as *mut c_void).is_err() {
            if let Ok(hbmp) = create_drag_bitmap() {
                let hcur = CreateIconIndirect(&ICONINFO {
                    f_icon: 0, x_hotspot: CARD_W as u32 / 2, y_hotspot: 12,
                    hbm_mask: ptr::null_mut(), hbm_color: hbmp,
                });
                if !hcur.is_null() {
                    let _ = DRAG_CURSOR.set(CursorHandle(hcur));
                }
            }
        }

        let mut effect = 0u32;
        let hr_drag = DoDragDrop(
            data_obj as *mut c_void,
            drop_src as *mut c_void,
            DROPEFFECT_COPY,
            &mut effect,
        );

        OleUninitialize();

        let _ = Box::from_raw(data_obj);
        let _ = Box::from_raw(drop_src);
        let _ = Box::from_raw(fp);

        if let Some(CursorHandle(hcur)) = DRAG_CURSOR.get() {
            DestroyIcon(*hcur);
        }

        if hr_drag < 0 {
            return Err(format!("DoDragDrop failed: 0x{:x}", hr_drag));
        }
    }

    Ok(())
}

unsafe fn set_drag_image(data_obj: *mut c_void) -> Result<(), String> {
    let hbmp = create_drag_bitmap()?;

    let mut helper: *mut c_void = ptr::null_mut();
    let hr = CoCreateInstance(
        &CLSID_DRAG_DROP_HELPER,
        ptr::null_mut(),
        1, // CLSCTX_INPROC_SERVER
        &IID_IDRAG_SOURCE_HELPER,
        &mut helper,
    );
    if hr < 0 || helper.is_null() {
        DeleteObject(hbmp);
        return Err(format!("CoCreateInstance DragDropHelper failed: 0x{:x}", hr));
    }

    let shdi = SHDRAGIMAGE {
        size_drag_image: SIZE { cx: CARD_W, cy: CARD_H },
        pt_offset: POINT { x: CARD_W / 2, y: 12 },
        hbmp_drag_image: hbmp,
        cr_color_key: BG_COLOR,
    };

    let vtbl = *(helper as *mut *const DragSourceHelperVtbl);
    let hr_img = ((*vtbl).initialize_from_bitmap)(helper, &shdi, data_obj);
    ((*vtbl).release)(helper);

    if hr_img < 0 {
        DeleteObject(hbmp);
        return Err(format!("InitializeFromBitmap failed: 0x{:x}", hr_img));
    }

    Ok(())
}

unsafe fn create_drag_bitmap() -> Result<*mut c_void, String> {
    let hdc_screen = GetDC(ptr::null_mut());
    if hdc_screen.is_null() { return Err("GetDC failed".into()); }

    let hdc = CreateCompatibleDC(hdc_screen);
    if hdc.is_null() {
        ReleaseDC(ptr::null_mut(), hdc_screen);
        return Err("CreateCompatibleDC failed".into());
    }

    let hbmp = CreateCompatibleBitmap(hdc_screen, CARD_W, CARD_H);
    if hbmp.is_null() {
        DeleteDC(hdc);
        ReleaseDC(ptr::null_mut(), hdc_screen);
        return Err("CreateCompatibleBitmap failed".into());
    }

    let old_bmp = SelectObject(hdc, hbmp);

    // Background fill
    let bg_brush = CreateSolidBrush(BG_COLOR);
    let old_brush = SelectObject(hdc, bg_brush as *mut c_void);
    PatBlt(hdc, 0, 0, CARD_W, CARD_H, 0x00F00021); // PATCOPY
    SelectObject(hdc, old_brush);
    DeleteObject(bg_brush as *mut c_void);

    // Dashed border
    draw_dashed_border(hdc, 0, 0, CARD_W, CARD_H, BORDER_COLOR, 4);

    // Icon: two stacked box outlines
    let iw = 22; let ih = 8; let ig = 3;
    let ix = (CARD_W - iw) / 2; let iy = 10;
    let thin_pen = CreatePen(0, 1, BORDER_COLOR);
    let old_pen = SelectObject(hdc, thin_pen as *mut c_void);
    let null_brush = GetStockObject(5);
    let old_brush2 = SelectObject(hdc, null_brush);
    Rectangle(hdc, ix, iy, ix + iw, iy + ih);
    Rectangle(hdc, ix, iy + ih + ig, ix + iw, iy + ih + ig + ih);
    SelectObject(hdc, old_pen);
    SelectObject(hdc, old_brush2);
    DeleteObject(thin_pen as *mut c_void);

    // Title
    SetBkMode(hdc, 1); // TRANSPARENT
    let title = "BLENDER ADDON\0".encode_utf16().collect::<Vec<_>>();
    SetTextColor(hdc, TEXT_COLOR);
    let mut tr = RECT { left: 0, top: 38, right: CARD_W, bottom: 58 };
    DrawTextW(hdc, title.as_ptr(), -1, &mut tr, DT_CENTER);

    // Subtitle
    let sub = "Drag into Blender to install\0".encode_utf16().collect::<Vec<_>>();
    SetTextColor(hdc, SUB_COLOR);
    let mut sr = RECT { left: 0, top: 56, right: CARD_W, bottom: 80 };
    DrawTextW(hdc, sub.as_ptr(), -1, &mut sr, DT_CENTER);

    SelectObject(hdc, old_bmp);
    DeleteDC(hdc);
    ReleaseDC(ptr::null_mut(), hdc_screen);
    Ok(hbmp)
}

unsafe fn draw_dashed_border(hdc: *mut c_void, l: i32, t: i32, r: i32, b: i32, color: u32, step: i32) {
    for x in l..r {
        if (x / step) % 2 == 0 {
            SetPixel(hdc, x, t, color); SetPixel(hdc, x, t + 1, color);
            SetPixel(hdc, x, b - 1, color); SetPixel(hdc, x, b - 2, color);
        }
    }
    for y in t..b {
        if (y / step) % 2 == 0 {
            SetPixel(hdc, l, y, color); SetPixel(hdc, l + 1, y, color);
            SetPixel(hdc, r - 1, y, color); SetPixel(hdc, r - 2, y, color);
        }
    }
}

// ── Win32 FFI ──

#[link(name = "ole32")]
extern "system" {
    fn OleInitialize(pw_reserved: *const c_void) -> i32;
    fn OleUninitialize();
    fn DoDragDrop(pdata_obj: *mut c_void, pdrop_source: *mut c_void, dw_ok_effect: u32, pdw_effect: *mut u32) -> i32;
    fn CoCreateInstance(rclsid: *const GUID, p_unk_outer: *mut c_void, dw_cls_context: u32, riid: *const GUID, ppv: *mut *mut c_void) -> i32;
}

#[link(name = "shell32")]
extern "system" {
    fn SHCreateStdEnumFmtEtc(cfmt: u32, afmt: *const FORMATETC, ppenum: *mut *mut c_void) -> i32;
}

#[link(name = "kernel32")]
extern "system" {
    fn GlobalAlloc(u_flags: u32, dw_bytes: usize) -> *mut c_void;
    fn GlobalLock(h_mem: *mut c_void) -> *mut c_void;
    fn GlobalUnlock(h_mem: *mut c_void) -> i32;
    fn GlobalFree(h_mem: *mut c_void) -> *mut c_void;
}

#[link(name = "gdi32")]
extern "system" {
    fn CreateCompatibleDC(hdc: *mut c_void) -> *mut c_void;
    fn DeleteDC(hdc: *mut c_void) -> i32;
    fn CreateCompatibleBitmap(hdc: *mut c_void, cx: i32, cy: i32) -> *mut c_void;
    fn DeleteObject(hobj: *mut c_void) -> i32;
    fn SelectObject(hdc: *mut c_void, hobj: *mut c_void) -> *mut c_void;
    fn GetStockObject(index: i32) -> *mut c_void;
    fn CreateSolidBrush(color: u32) -> *mut c_void;
    fn CreatePen(style: i32, width: i32, color: u32) -> *mut c_void;
    fn Rectangle(hdc: *mut c_void, left: i32, top: i32, right: i32, bottom: i32) -> i32;
    fn SetPixel(hdc: *mut c_void, x: i32, y: i32, color: u32) -> u32;
    fn PatBlt(hdc: *mut c_void, x: i32, y: i32, w: i32, h: i32, rop: u32) -> i32;
    fn SetBkMode(hdc: *mut c_void, mode: i32) -> i32;
    fn SetTextColor(hdc: *mut c_void, color: u32) -> u32;
}

#[link(name = "user32")]
extern "system" {
    fn GetDC(hwnd: *mut c_void) -> *mut c_void;
    fn ReleaseDC(hwnd: *mut c_void, hdc: *mut c_void) -> i32;
    fn DrawTextW(hdc: *mut c_void, str: *const u16, len: i32, rect: *mut RECT, format: u32) -> i32;
    fn SetCursor(hcur: *mut c_void) -> *mut c_void;
    fn CreateIconIndirect(piconinfo: *const ICONINFO) -> *mut c_void;
    fn DestroyIcon(hicon: *mut c_void) -> i32;
    fn GetCursorPos(pt: *mut POINT) -> i32;
    fn GetWindowRect(hwnd: *mut c_void, rc: *mut RECT) -> i32;
}

// ── COM & OLE types ──

type HRESULT = i32;
const S_OK: HRESULT = 0;
const E_NOTIMPL: HRESULT = 0x80004001u32 as i32;
const E_NOINTERFACE: HRESULT = 0x80004002u32 as i32;
const E_OUTOFMEMORY: HRESULT = 0x8007000Eu32 as i32;
const DRAGDROP_S_CANCEL: HRESULT = 0x00040101;
const DRAGDROP_S_DROP: HRESULT = 0x00040100;
const DRAGDROP_S_USEDEFAULTCURSORS: HRESULT = 0x00040102;
const OLE_E_ADVISENOTSUPPORTED: HRESULT = 0x80040002u32 as i32;
const DV_E_FORMATETC: HRESULT = 0x80040064u32 as i32;
const DROPEFFECT_COPY: u32 = 1;
const DATADIR_GET: u32 = 1;
const CF_HDROP: u16 = 15;
const TYMED_HGLOBAL: u32 = 1;
const GMEM_MOVEABLE: u32 = 0x0002;
const GMEM_ZEROINIT: u32 = 0x0040;
const DT_CENTER: u32 = 0x00000001;

#[repr(C)]
struct GUID { data1: u32, data2: u16, data3: u16, data4: [u8; 8] }

const IID_IUNKNOWN: GUID = GUID { data1: 0x00000000, data2: 0x0000, data3: 0x0000, data4: [0xC0, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x46] };
const IID_IDATAOBJECT: GUID = GUID { data1: 0x0000010E, data2: 0x0000, data3: 0x0000, data4: [0xC0, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x46] };
const IID_IDROPSOURCE: GUID = GUID { data1: 0x00000121, data2: 0x0000, data3: 0x0000, data4: [0xC0, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x46] };
const CLSID_DRAG_DROP_HELPER: GUID = GUID { data1: 0x4657278A, data2: 0x411B, data3: 0x11D2, data4: [0x83, 0x9A, 0x00, 0xC0, 0x4F, 0xD9, 0x18, 0xD0] };
const IID_IDRAG_SOURCE_HELPER: GUID = GUID { data1: 0xDE5BF786, data2: 0x477A, data3: 0x11D2, data4: [0x83, 0x9D, 0x00, 0xC0, 0x4F, 0xD9, 0x18, 0xD0] };

unsafe fn guid_eq(a: *const GUID, b: *const GUID) -> bool {
    let a = &*a; let b = &*b;
    a.data1 == b.data1 && a.data2 == b.data2 && a.data3 == b.data3 && a.data4 == b.data4
}

#[repr(C)]
#[derive(Clone, Copy)]
struct SIZE { cx: i32, cy: i32 }
#[repr(C)]
#[derive(Clone, Copy)]
struct POINT { x: i32, y: i32 }
#[repr(C)]
#[derive(Clone, Copy)]
struct RECT { left: i32, top: i32, right: i32, bottom: i32 }
#[repr(C)]
struct ICONINFO { f_icon: i32, x_hotspot: u32, y_hotspot: u32, hbm_mask: *mut c_void, hbm_color: *mut c_void }
#[repr(C)]
struct SHDRAGIMAGE { size_drag_image: SIZE, pt_offset: POINT, hbmp_drag_image: *mut c_void, cr_color_key: u32 }
#[repr(C)]
struct DragSourceHelperVtbl {
    query_interface: unsafe extern "system" fn(*mut c_void, *const GUID, *mut *mut c_void) -> i32,
    add_ref: unsafe extern "system" fn(*mut c_void) -> u32,
    release: unsafe extern "system" fn(*mut c_void) -> u32,
    initialize_from_bitmap: unsafe extern "system" fn(*mut c_void, *const SHDRAGIMAGE, *mut c_void) -> i32,
    set_from_cursor: unsafe extern "system" fn(*mut c_void, *mut c_void, i32, i32) -> i32,
}
#[repr(C)]
#[derive(Clone, Copy)]
struct FORMATETC {
    cf_format: u16, _pad: [u8; 6], ptd: *mut c_void,
    dw_aspect: u32, lindex: i32, tymed: u32, _trailing: u32,
}
#[repr(C)]
#[derive(Clone, Copy)]
struct STGMEDIUM {
    tymed: u32, _pad: [u8; 4], h_global: *mut c_void, p_unk_for_release: *mut c_void,
}
#[repr(C)]
#[derive(Clone, Copy)]
struct DROPFILES_RAW { p_files: u32, x: i32, y: i32, f_nc: i32, f_wide: i32 }

// ── IDataObject ──

type QIFn = unsafe extern "system" fn(*mut c_void, *const GUID, *mut *mut c_void) -> i32;
type ARefFn = unsafe extern "system" fn(*mut c_void) -> u32;
type RelFn = unsafe extern "system" fn(*mut c_void) -> u32;

#[repr(C)]
struct IUnknownVtbl { query_interface: QIFn, add_ref: ARefFn, release: RelFn }

struct FilePath { data: Vec<u16> }

#[repr(C)]
struct DataObject {
    vtbl: &'static DataObjectVtbl, ref_count: u32, file_path: *const FilePath,
    has_stored: bool, stored_fmt: FORMATETC, stored_med: STGMEDIUM,
}
#[repr(C)]
struct DataObjectVtbl {
    iunknown: IUnknownVtbl,
    get_data: unsafe extern "system" fn(*mut c_void, *const FORMATETC, *mut STGMEDIUM) -> i32,
    get_data_here: unsafe extern "system" fn(*mut c_void, *const FORMATETC, *mut STGMEDIUM) -> i32,
    query_get_data: unsafe extern "system" fn(*mut c_void, *const FORMATETC) -> i32,
    get_canonical_format_etc: unsafe extern "system" fn(*mut c_void, *const FORMATETC, *mut FORMATETC) -> i32,
    set_data: unsafe extern "system" fn(*mut c_void, *const FORMATETC, *const STGMEDIUM, i32) -> i32,
    enum_format_etc: unsafe extern "system" fn(*mut c_void, u32, *mut *mut c_void) -> i32,
    d_advise: unsafe extern "system" fn(*mut c_void, *const FORMATETC, u32, *mut c_void, *mut u32) -> i32,
    d_unadvise: unsafe extern "system" fn(*mut c_void, u32) -> i32,
    enum_d_advise: unsafe extern "system" fn(*mut c_void, *mut *mut c_void) -> i32,
}

impl DataObject {
    fn new(file_path: *const FilePath) -> Self {
        DataObject {
            vtbl: &DATA_OBJECT_VTBL, ref_count: 1, file_path,
            has_stored: false,
            stored_fmt: unsafe { std::mem::zeroed() },
            stored_med: unsafe { std::mem::zeroed() },
        }
    }
}

unsafe extern "system" fn data_query_interface(
    this: *mut c_void, riid: *const GUID, ppv: *mut *mut c_void,
) -> i32 {
    if guid_eq(riid, &IID_IUNKNOWN) || guid_eq(riid, &IID_IDATAOBJECT) {
        let obj = &mut *(this as *mut DataObject); obj.ref_count += 1; *ppv = this; S_OK
    } else { *ppv = ptr::null_mut(); E_NOINTERFACE }
}
unsafe extern "system" fn data_add_ref(this: *mut c_void) -> u32 {
    let obj = &mut *(this as *mut DataObject); obj.ref_count += 1; obj.ref_count
}
unsafe extern "system" fn data_release(this: *mut c_void) -> u32 {
    let obj = &mut *(this as *mut DataObject); obj.ref_count -= 1; obj.ref_count
}

unsafe extern "system" fn data_get_data(
    this: *mut c_void, pformatetc: *const FORMATETC, pmedium: *mut STGMEDIUM,
) -> i32 {
    let fmt = &*pformatetc;
    let obj = &*(this as *const DataObject);

    if obj.has_stored && obj.stored_fmt.cf_format == fmt.cf_format {
        *pmedium = obj.stored_med;
        return S_OK;
    }

    if fmt.cf_format != CF_HDROP || (fmt.tymed & TYMED_HGLOBAL) == 0 { return DV_E_FORMATETC; }
    let fp = &*obj.file_path;
    let drop_size = std::mem::size_of::<DROPFILES_RAW>();
    let path_bytes = fp.data.len() * 2;
    let total = drop_size + path_bytes;
    let hglob = GlobalAlloc(GMEM_MOVEABLE | GMEM_ZEROINIT, total);
    if hglob.is_null() { return E_OUTOFMEMORY; }
    let lock = GlobalLock(hglob) as *mut u8;
    if lock.is_null() { GlobalFree(hglob); return E_OUTOFMEMORY; }
    let df = lock as *mut DROPFILES_RAW;
    df.write(DROPFILES_RAW { p_files: drop_size as u32, x: 0, y: 0, f_nc: 0, f_wide: 1 });
    ptr::copy_nonoverlapping(fp.data.as_ptr(), lock.add(drop_size) as *mut u16, fp.data.len());
    GlobalUnlock(hglob);
    let med = &mut *pmedium;
    med.tymed = TYMED_HGLOBAL; med.h_global = hglob; med.p_unk_for_release = ptr::null_mut();
    S_OK
}
unsafe extern "system" fn data_get_data_here(
    _: *mut c_void, _: *const FORMATETC, _: *mut STGMEDIUM,
) -> i32 { E_NOTIMPL }

unsafe extern "system" fn data_query_get_data(
    this: *mut c_void, p: *const FORMATETC,
) -> i32 {
    let obj = &*(this as *const DataObject);
    let fmt = &*p;
    if obj.has_stored && obj.stored_fmt.cf_format == fmt.cf_format { return S_OK; }
    if fmt.cf_format == CF_HDROP { S_OK } else { DV_E_FORMATETC }
}
unsafe extern "system" fn data_get_canonical_format_etc(
    _: *mut c_void, _: *const FORMATETC, out: *mut FORMATETC,
) -> i32 { (*out).ptd = ptr::null_mut(); S_OK }

unsafe extern "system" fn data_set_data(
    this: *mut c_void, pformatetc: *const FORMATETC, pmedium: *const STGMEDIUM, _: i32,
) -> i32 {
    let obj = &mut *(this as *mut DataObject);
    obj.stored_fmt = *pformatetc;
    obj.stored_med = *pmedium;
    obj.has_stored = true;
    S_OK
}

unsafe extern "system" fn data_enum_format_etc(
    this: *mut c_void, dir: u32, pp: *mut *mut c_void,
) -> i32 {
    if dir != DATADIR_GET { return E_NOTIMPL; }
    let obj = &*(this as *const DataObject);
    if obj.has_stored {
        let fmts = [obj.stored_fmt, FORMATETC {
            cf_format: CF_HDROP, _pad: [0; 6], ptd: ptr::null_mut(),
            dw_aspect: 1, lindex: -1, tymed: TYMED_HGLOBAL, _trailing: 0,
        }];
        SHCreateStdEnumFmtEtc(2, &fmts as *const FORMATETC, pp)
    } else {
        let fmt = FORMATETC {
            cf_format: CF_HDROP, _pad: [0; 6], ptd: ptr::null_mut(),
            dw_aspect: 1, lindex: -1, tymed: TYMED_HGLOBAL, _trailing: 0,
        };
        SHCreateStdEnumFmtEtc(1, &fmt, pp)
    }
}
unsafe extern "system" fn data_d_advise(
    _: *mut c_void, _: *const FORMATETC, _: u32, _: *mut c_void, _: *mut u32,
) -> i32 { OLE_E_ADVISENOTSUPPORTED }
unsafe extern "system" fn data_d_unadvise(_: *mut c_void, _: u32) -> i32 { OLE_E_ADVISENOTSUPPORTED }
unsafe extern "system" fn data_enum_d_advise(_: *mut c_void, _: *mut *mut c_void) -> i32 { OLE_E_ADVISENOTSUPPORTED }

static DATA_OBJECT_VTBL: DataObjectVtbl = DataObjectVtbl {
    iunknown: IUnknownVtbl { query_interface: data_query_interface, add_ref: data_add_ref, release: data_release },
    get_data: data_get_data, get_data_here: data_get_data_here,
    query_get_data: data_query_get_data, get_canonical_format_etc: data_get_canonical_format_etc,
    set_data: data_set_data, enum_format_etc: data_enum_format_etc,
    d_advise: data_d_advise, d_unadvise: data_d_unadvise, enum_d_advise: data_enum_d_advise,
};

// ── IDropSource ──

#[repr(C)]
struct DropSource { vtbl: &'static DropSourceVtbl, ref_count: u32, hwnd: *mut c_void }
#[repr(C)]
struct DropSourceVtbl {
    iunknown: IUnknownVtbl,
    query_continue_drag: unsafe extern "system" fn(*mut c_void, i32, u32) -> i32,
    give_feedback: unsafe extern "system" fn(*mut c_void, u32) -> i32,
}
unsafe extern "system" fn drop_query_interface(
    this: *mut c_void, riid: *const GUID, ppv: *mut *mut c_void,
) -> i32 {
    if guid_eq(riid, &IID_IUNKNOWN) || guid_eq(riid, &IID_IDROPSOURCE) {
        let obj = &mut *(this as *mut DropSource); obj.ref_count += 1; *ppv = this; S_OK
    } else { *ppv = ptr::null_mut(); E_NOINTERFACE }
}
unsafe extern "system" fn drop_add_ref(this: *mut c_void) -> u32 {
    let obj = &mut *(this as *mut DropSource); obj.ref_count += 1; obj.ref_count
}
unsafe extern "system" fn drop_release(this: *mut c_void) -> u32 {
    let obj = &mut *(this as *mut DropSource); obj.ref_count -= 1; obj.ref_count
}
unsafe extern "system" fn query_continue_drag(
    this: *mut c_void, esc: i32, keys: u32,
) -> i32 {
    if esc != 0 { return DRAGDROP_S_CANCEL; }
    const MK_LBUTTON: u32 = 1;
    if (keys & MK_LBUTTON) == 0 {
        // Mouse button released — cancel if cursor is inside our own window
        let src = &*(this as *const DropSource);
        if !src.hwnd.is_null() {
            let mut pt = POINT { x: 0, y: 0 };
            if GetCursorPos(&mut pt) != 0 {
                let mut rc = RECT { left: 0, top: 0, right: 0, bottom: 0 };
                if GetWindowRect(src.hwnd, &mut rc) != 0 {
                    if pt.x >= rc.left && pt.x < rc.right && pt.y >= rc.top && pt.y < rc.bottom {
                        return DRAGDROP_S_CANCEL;
                    }
                }
            }
        }
        return DRAGDROP_S_DROP;
    }
    S_OK
}
unsafe extern "system" fn give_feedback(_: *mut c_void, _: u32) -> i32 {
    if let Some(CursorHandle(hcur)) = DRAG_CURSOR.get() {
        SetCursor(*hcur);
        S_OK
    } else {
        DRAGDROP_S_USEDEFAULTCURSORS
    }
}

static DROP_SOURCE_VTBL: DropSourceVtbl = DropSourceVtbl {
    iunknown: IUnknownVtbl { query_interface: drop_query_interface, add_ref: drop_add_ref, release: drop_release },
    query_continue_drag, give_feedback,
};

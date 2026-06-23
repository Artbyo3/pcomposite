bl_info = {
    "name": "PCOMPOSITE Bridge",
    "author": "PCOMPOSITE",
    "version": (2, 1),
    "blender": (4, 0, 0),
    "location": "View3D > Sidebar > PCOMPOSITE",
    "description": "Import bridge for the PCOMPOSITE bases library",
    "category": "Import-Export",
}

import bpy
import json
import os
import platform
from datetime import date
from bpy.props import EnumProperty, StringProperty
from bpy.types import AddonPreferences, Operator, Panel

ADDON_NAME = __name__.partition(".")[0]
BUNDLE_ID = "com.pcomposite.dev"
DIR_NAME = "pcomposite"
BRIDGE_FILE = "bridge_context.json"


def _get_data_dir():
    system = platform.system()
    if system == "Windows":
        base = os.environ.get("APPDATA", "")
    elif system == "Darwin":
        base = os.path.expanduser("~/Library/Application Support")
    else:
        base = os.environ.get("XDG_DATA_HOME", os.path.expanduser("~/.local/share"))
    return os.path.join(base, BUNDLE_ID, DIR_NAME)


def _context_path():
    prefs = bpy.context.preferences.addons.get(ADDON_NAME)
    data_dir = prefs.preferences.data_dir if prefs else ""
    if not data_dir:
        data_dir = _get_data_dir()
    return os.path.join(data_dir, BRIDGE_FILE)


def _load_context():
    path = _context_path()
    if not os.path.exists(path):
        return None
    try:
        with open(path, "r") as f:
            return json.load(f)
    except Exception:
        return None


def _write_context(ctx):
    path = _context_path()
    try:
        with open(path, "w") as f:
            json.dump(ctx, f, indent=2)
    except Exception:
        pass


def _imported_set(ctx):
    """Return set of (group, file) tuples that have been imported."""
    imported = ctx.get("imported_bases", [])
    return {(i.get("group", ""), i.get("file", "")) for i in imported}


# ── Preferences ──

class PCOM_AP_addon_preferences(AddonPreferences):
    bl_idname = ADDON_NAME

    data_dir: StringProperty(
        name="PCOMPOSITE Data Folder",
        description="Path to PCOMPOSITE app data. Leave empty for auto-detect.",
        default="",
        subtype="DIR_PATH",
    )

    def draw(self, context):
        layout = self.layout
        layout.prop(self, "data_dir")
        auto = _get_data_dir()
        if self.data_dir != auto:
            row = layout.row()
            row.label(text=f"Default: {auto}")
            row.operator("pcom.reset_data_dir", text="Reset")


class PCOM_OT_reset_data_dir(Operator):
    bl_idname = "pcom.reset_data_dir"
    bl_label = "Reset Data Directory"
    bl_options = {"INTERNAL"}

    def execute(self, context):
        prefs = context.preferences.addons[ADDON_NAME].preferences
        prefs.data_dir = ""
        return {"FINISHED"}


# ── Import Operator ──

class PCOM_OT_import_base(Operator):
    bl_idname = "pcom.import_base"
    bl_label = "Import Base Mesh"
    bl_description = "Open the FBX import dialog with the pre-filled base file"

    filepath: StringProperty(default="", subtype="FILE_PATH", options={"HIDDEN", "SKIP_SAVE"})
    group_name: StringProperty(default="", options={"HIDDEN"})
    base_filename: StringProperty(default="", options={"HIDDEN"})

    def execute(self, context):
        bpy.ops.import_scene.fbx("INVOKE_DEFAULT", filepath=self.filepath)
        ctx = _load_context()
        if ctx and ctx.get("version", 1) >= 2:
            imported = ctx.setdefault("imported_bases", [])
            exists = any(i.get("file") == self.base_filename and i.get("group") == self.group_name for i in imported)
            if not exists:
                imported.append({
                    "file": self.base_filename,
                    "group": self.group_name,
                    "imported_at": date.today().isoformat(),
                })
            ctx["pending_action"] = None
            _write_context(ctx)
        return {"FINISHED"}


# ── Export Operators ──

class PCOM_OT_export_base(Operator):
    bl_idname = "pcom.export_base"
    bl_label = "Export Base FBX"
    bl_description = "Open the FBX export dialog with the pre-filled save path"

    filepath: StringProperty(default="", subtype="FILE_PATH", options={"HIDDEN", "SKIP_SAVE"})

    def execute(self, context):
        bpy.ops.export_scene.fbx("INVOKE_DEFAULT", filepath=self.filepath)
        return {"FINISHED"}


class PCOM_OT_quick_export(Operator):
    bl_idname = "pcom.quick_export"
    bl_label = "Quick Export FBX"
    bl_description = "Open a standard FBX export dialog"

    def execute(self, context):
        bpy.ops.export_scene.fbx("INVOKE_DEFAULT")
        return {"FINISHED"}


# ── Refresh Operator ──

class PCOM_OT_refresh(Operator):
    bl_idname = "pcom.refresh"
    bl_label = "Refresh"
    bl_description = "Reload PCOMPOSITE bridge context"

    def execute(self, context):
        return {"FINISHED"}


# ── N-Panel UI ──

def _project_box(layout, ctx):
    box = layout.box()
    col = box.column(align=True)
    row = col.row()
    row.label(text="", icon="FILE_FOLDER")
    row.label(text=ctx.get("active_project_name", "—"))
    col.label(text=ctx.get("active_project_id", ""), icon="DOT")


def _draw_pending(layout, ctx):
    pending = ctx.get("pending_action")
    if not pending or pending.get("type") != "import":
        return

    fname = pending.get("file", "")
    group = pending.get("group", "")
    bases_path = ctx.get("bases_path", "")
    proj_path = ctx.get("active_project_path", "")

    # Try project/blender/ first (pre-copied by PCOMPOSITE), then _bases/group/
    blender_path = os.path.join(proj_path, "blender", fname) if proj_path else ""
    group_path = os.path.join(bases_path, group, fname) if bases_path else ""

    full_path = blender_path if os.path.exists(blender_path) else group_path
    if not os.path.exists(full_path):
        return

    box = layout.box()
    col = box.column(align=True)
    col.label(text="PENDING IMPORT", icon="IMPORT")
    row = col.row()
    row.scale_y = 1.8
    op = row.operator("pcom.import_base", text=f"Import {fname}  —  {group}")
    op.filepath = full_path
    op.group_name = group
    op.base_filename = fname
    layout.separator()
    ctx["pending_action"] = None
    _write_context(ctx)


def _draw_import(layout, ctx):
    layout.label(text="Import Bases", icon="IMPORT")
    library = ctx.get("bases_library", {})
    bases_path = ctx.get("bases_path", "")
    imported = _imported_set(ctx)

    if not library:
        layout.label(text="No bases in library", icon="DOT")
        return

    for group_name in sorted(library.keys()):
        files = library[group_name]
        if not files:
            continue
        box = layout.box()
        row = box.row()
        row.label(text=group_name, icon="GROUP")
        row.label(text=str(len(files)) + " file" + ("s" if len(files) != 1 else ""))

        for f in files:
            fname = f.get("name", "")
            is_done = (group_name, fname) in imported
            full_path = os.path.join(bases_path, group_name, fname) if bases_path else ""
            if not full_path or not os.path.exists(full_path):
                r = box.row()
                r.label(text=fname, icon="ERROR")
                r.label(text="file not found")
                continue
            row2 = box.row(align=True)
            op = row2.operator("pcom.import_base", text=fname)
            op.filepath = full_path
            op.group_name = group_name
            op.base_filename = fname
            if is_done:
                row2.label(text="", icon="CHECKBOX_HLT")


def _draw_export(layout, ctx):
    layout.label(text="Export FBX", icon="EXPORT")
    targets = ctx.get("export_targets", [])
    if targets:
        proj_path = ctx.get("active_project_path", "")
        for t in targets:
            name = t.get("target", "")
            ver = t.get("version", 0) + 1
            fbx_path = os.path.join(proj_path, "fbx", f"{name}_v{ver}.fbx")
            op = layout.operator("pcom.export_base", text=f"Export \u2013 {name}")
            op.filepath = fbx_path
    else:
        layout.label(text="No export targets configured", icon="DOT")

    layout.separator()
    layout.operator("pcom.quick_export", text="Quick Export FBX", icon="EXPORT")


class PCOM_PT_main_panel(Panel):
    bl_label = "PCOMPOSITE"
    bl_idname = "PCOM_PT_main_panel"
    bl_space_type = "VIEW_3D"
    bl_region_type = "UI"
    bl_category = "PCOMPOSITE"

    def draw(self, context):
        layout = self.layout
        scene = context.scene
        ctx = _load_context()

        if ctx is None:
            layout.label(text="No PCOMPOSITE context found", icon="INFO")
            layout.label(text="Open PCOMPOSITE and select a project")
            return

        _project_box(layout, ctx)

        layout.separator()
        row = layout.row(align=True)
        row.scale_y = 1.4
        row.prop(scene, "pcom_tab", expand=True)

        layout.separator()

        if scene.pcom_tab == "IMPORT":
            _draw_pending(layout, ctx)
            _draw_import(layout, ctx)
        else:
            _draw_export(layout, ctx)

        layout.separator()
        layout.operator("pcom.refresh", text="Refresh", icon="FILE_REFRESH")


# ── Registration ──

classes = [
    PCOM_AP_addon_preferences,
    PCOM_OT_reset_data_dir,
    PCOM_OT_import_base,
    PCOM_OT_export_base,
    PCOM_OT_quick_export,
    PCOM_OT_refresh,
    PCOM_PT_main_panel,
]


def register():
    for cls in classes:
        bpy.utils.register_class(cls)
    bpy.types.Scene.pcom_tab = EnumProperty(
        name="Tab",
        items=[
            ("IMPORT", "Import", "Import base meshes", "IMPORT", 0),
            ("EXPORT", "Export", "Export FBX files", "EXPORT", 1),
        ],
        default="IMPORT",
    )


def unregister():
    del bpy.types.Scene.pcom_tab
    for cls in reversed(classes):
        bpy.utils.unregister_class(cls)


if __name__ == "__main__":
    register()

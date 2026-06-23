bl_info = {
    "name": "PCOMPOSITE Bridge",
    "author": "PCOMPOSITE",
    "version": (1, 1),
    "blender": (4, 0, 0),
    "location": "View3D > Sidebar > PCOMPOSITE",
    "description": "Import/export bridge for the PCOMPOSITE asset pipeline",
    "category": "Import-Export",
}

import bpy
import json
import os
import platform
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

    def execute(self, context):
        bpy.ops.import_scene.fbx("INVOKE_DEFAULT", filepath=self.filepath)
        return {"FINISHED"}


# ── Export Operator ──

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


# ── N-Panel UI ──

def _project_box(layout, ctx):
    box = layout.box()
    col = box.column(align=True)
    row = col.row()
    row.label(text="", icon="FILE_FOLDER")
    row.label(text=ctx.get("active_project_name", "—"))
    col.label(text=ctx.get("active_project_id", ""), icon="DOT")


def _draw_import(layout, ctx):
    layout.label(text="Import Base", icon="IMPORT")
    bases = ctx.get("imported_bases", [])
    if bases:
        bases_path = ctx.get("bases_path", "")
        for base_name in bases:
            full_path = os.path.join(bases_path, base_name) if bases_path else ""
            if not full_path or not os.path.exists(full_path):
                row = layout.row()
                row.label(text=base_name, icon="ERROR")
                row.label(text="file not found")
                continue
            op = layout.operator("pcom.import_base", text=base_name)
            op.filepath = full_path
    else:
        layout.label(text="No imported bases", icon="DOT")


def _draw_export(layout, ctx):
    layout.label(text="Export FBX", icon="EXPORT")
    targets = ctx.get("export_targets", [])
    if targets:
        proj_path = ctx.get("active_project_path", "")
        for t in targets:
            name = t.get("target", "")
            ver = t.get("version", 0) + 1
            fbx_path = os.path.join(proj_path, "fbx", f"{name}_v{ver}.fbx")
            op = layout.operator("pcom.export_base", text=f"Export – {name}")
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
            _draw_import(layout, ctx)
        else:
            _draw_export(layout, ctx)


# ── Registration ──

classes = [
    PCOM_AP_addon_preferences,
    PCOM_OT_reset_data_dir,
    PCOM_OT_import_base,
    PCOM_OT_export_base,
    PCOM_OT_quick_export,
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

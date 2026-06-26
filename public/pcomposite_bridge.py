bl_info = {
    "name": "PCOMPOSITE Bridge",
    "author": "PCOMPOSITE",
    "version": (2, 2),
    "blender": (4, 0, 0),
    "location": "View3D > Sidebar > PCOMPOSITE",
    "description": "Import bridge for the PCOMPOSITE bases library",
    "category": "Import-Export",
}

import bpy
import json
import os
import platform
import re
from datetime import date
from bpy.props import EnumProperty, IntProperty, StringProperty
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

def _format_export_name(pattern, project, target, version):
    """Apply naming pattern and sanitize for filesystem."""
    name = pattern
    name = name.replace("{project}", project)
    name = name.replace("{target}", target)
    name = name.replace("{version}", str(version))
    name = name.replace("{date}", date.today().isoformat())
    name = name.replace(" ", "_")
    name = re.sub(r'[<>:"/\\|?*]', "", name)
    return name.strip("_. ") or f"{target}_v{version}"


class PCOM_OT_export_tracked(Operator):
    bl_idname = "pcom.export_tracked"
    bl_label = "Export FBX"
    bl_description = "Open the FBX export dialog with the pre-filled versioned path and track the export"

    export_path: StringProperty(default="", subtype="FILE_PATH", options={"HIDDEN", "SKIP_SAVE"})
    target: StringProperty(options={"HIDDEN"})
    next_version: IntProperty(options={"HIDDEN"})

    def execute(self, context):
        ver = self.next_version or 1
        export_dir = os.path.dirname(self.export_path)
        os.makedirs(export_dir, exist_ok=True)

        self._pre_existing = 0
        if os.path.exists(self.export_path):
            self._pre_existing = os.path.getsize(self.export_path)

        bpy.ops.export_scene.fbx("INVOKE_DEFAULT", filepath=self.export_path)

        context.window_manager.modal_handler_add(self)
        self._timer = context.window_manager.event_timer_add(0.5, window=context.window)
        self._checks = 0
        return {"RUNNING_MODAL"}

    def modal(self, context, event):
        if event.type != "TIMER":
            return {"PASS_THROUGH"}
        self._checks += 1
        if self._checks > 40:
            context.window_manager.event_timer_remove(self._timer)
            return {"FINISHED"}
        if os.path.exists(self.export_path):
            size = os.path.getsize(self.export_path)
            if size > self._pre_existing + 100:
                self._write_pending_export()
                context.window_manager.event_timer_remove(self._timer)
                self.report({"INFO"}, f"Exported {os.path.basename(self.export_path)}")
                return {"FINISHED"}
        return {"PASS_THROUGH"}

    def _write_pending_export(self):
        ctx = _load_context() or {}
        ctx["pending_export"] = {
            "target": self.target,
            "version": self.next_version,
            "date": date.today().isoformat(),
            "file": os.path.basename(self.export_path),
        }
        # Bump local version so addon shows the correct next_version immediately
        targets = ctx.get("export_targets", [])
        for t in targets:
            if t.get("target") == self.target:
                t["latest_version"] = self.next_version
                t["next_version"] = self.next_version + 1
                break
        _write_context(ctx)


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
    proj_path = ctx.get("active_project_path", "")
    proj_name = ctx.get("active_project_name", "")
    pattern = ctx.get("export_naming_pattern", "{target}_v{version}")
    if targets:
        for t in targets:
            name = t.get("target", "")
            ver = t.get("next_version", 1)
            display_name = _format_export_name(pattern, proj_name, name, ver) + ".fbx"
            export_dir = os.path.join(proj_path, "fbx", name)
            full_path = os.path.join(export_dir, display_name).replace("\\", "/")

            box = layout.box()
            row = box.row()
            row.label(text=name.upper(), icon="GROUP")
            row = box.row()
            row.scale_y = 0.6
            op = row.operator("pcom.export_tracked", text=display_name)
            op.export_path = full_path
            op.target = name
            op.next_version = ver
    else:
        layout.label(text="No targets available", icon="DOT")


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
    PCOM_OT_export_tracked,
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

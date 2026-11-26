"""POC step 2: turn the .3dm into a web-ready GLB.

Why this step exists
    A browser cannot open a 1 GB .3dm: rhino3dm.js would need the whole file
    and about 2 GB of RAM in the tab. The workable design is:

        server: .3dm  ->  rhino3dm  ->  GLB (meshes, one node per layer)
        browser: GLB + three.js, layer list, orbit camera

    This script builds that GLB plus scene.json for the viewer.

Block instances
    79 percent of the objects in this file live inside block definitions, so
    they are exported through their InstanceReference transform, recursively
    (definitions can contain other blocks). Definition objects themselves are
    not drawn twice.

Limits
    openNURBS can read Breps but cannot tessellate them, so this export
    contains Mesh and Extrusion objects only. Breps, curves, text and hatches
    are counted in "skipped" so the viewer can say so honestly.

Usage
    python export_web_scene.py --file "D:\\rhino\\260816_TPRO-SK_Full_ver1.3dm"
"""

import argparse
import gc
import json
import os
import struct
import sys
import time
from collections import Counter

import numpy as np
import rhino3dm
import trimesh

# Tuning constants.
DEFAULT_OUTPUT_DIR = r"D:\rhino\data\projects\TPRO\versions\v1"
SOURCE_UNIT_TO_METER = 0.001   # the file is in millimetres
PROGRESS_EVERY = 20000
MAX_DEFINITION_DEPTH = 20      # guard against a block that contains itself
DARK_CHANNEL_LIMIT = 40        # layer colours below this are treated as "no colour"
GROUP_PALETTE = (
    ("BG Revit", (150, 160, 172)),
    ("BG IN Rhino", (196, 176, 144)),
    ("CAD", (128, 148, 186)),
    ("Contour", (112, 148, 108)),
    ("Compare", (168, 132, 132)),
)
DEFAULT_LAYER_COLOR = (168, 168, 168)


# SECTION 1: command line helpers

def parse_arguments():
    parser = argparse.ArgumentParser(description="Export a .3dm to GLB for the web viewer.")
    parser.add_argument("--source", required=True, help="Path of the .3dm file.")
    parser.add_argument("--output-dir", default=DEFAULT_OUTPUT_DIR,
                        help="Folder that receives model.glb, scene.json and objects.json.")
    return parser.parse_args()


def srgb_to_linear(channel_value):
    channel = channel_value / 255.0
    if channel <= 0.04045:
        return channel / 12.92
    return ((channel + 0.055) / 1.055) ** 2.4


# SECTION 2: mesh extraction

def mesh_to_arrays(mesh):
    """Return (vertices float32 Nx3 in source units, triangles int32 Mx3)."""
    points = mesh.Vertices.ToPoint3fArray()
    if len(points) == 0:
        return None
    vertices = np.array([(point.X, point.Y, point.Z) for point in points],
                        dtype=np.float32)

    face_list = mesh.Faces
    face_count = len(face_list)
    if face_count == 0:
        return None

    if face_list.QuadCount == face_count:
        quads = np.array([tuple(face) for face in face_list], dtype=np.int32)
        triangles = np.empty((face_count * 2, 3), dtype=np.int32)
        triangles[0::2] = quads[:, [0, 1, 2]]
        triangles[1::2] = quads[:, [0, 2, 3]]
    else:
        triangle_list = []
        for face in face_list:
            if len(face) == 3:
                triangle_list.append(face)
            elif len(face) == 4:
                triangle_list.append((face[0], face[1], face[2]))
                triangle_list.append((face[0], face[2], face[3]))
        if not triangle_list:
            return None
        triangles = np.array(triangle_list, dtype=np.int32)
    return vertices, triangles


def object_mesh(geometry):
    """Return a Mesh for the object types this exporter can draw."""
    kind = type(geometry).__name__
    if kind == "Mesh":
        return geometry
    if kind == "Extrusion":
        try:
            return geometry.GetMesh(rhino3dm.MeshType.Default)
        except Exception:
            return None
    return None


def transform_matrix(xform):
    rotation = np.array([
        [xform.M00, xform.M01, xform.M02],
        [xform.M10, xform.M11, xform.M12],
        [xform.M20, xform.M21, xform.M22],
    ], dtype=np.float64)
    translation = np.array([xform.M03, xform.M13, xform.M23], dtype=np.float64)
    return rotation, translation


def concatenate_arrays(chunks):
    """Combine (vertices, triangles) chunks into one pair."""
    if not chunks:
        return None
    if len(chunks) == 1:
        return chunks[0]
    vertices = np.vstack([chunk[0] for chunk in chunks])
    triangle_chunks = []
    vertex_offset = 0
    for chunk_vertices, chunk_triangles in chunks:
        triangle_chunks.append(chunk_triangles + vertex_offset)
        vertex_offset += len(chunk_vertices)
    triangles = np.vstack(triangle_chunks)
    return vertices, triangles


# SECTION 3: block definitions

def collect_definition_members(model):
    """Store geometry of definition objects, keyed by object id string."""
    members = {}
    skipped_types = Counter()
    for file_object in model.Objects:
        if not file_object.Attributes.IsInstanceDefinitionObject:
            continue
        geometry = file_object.Geometry
        kind = type(geometry).__name__
        if kind == "InstanceReference":
            rotation, translation = transform_matrix(geometry.Xform)
            members[str(file_object.Attributes.Id)] = (
                "instance", str(geometry.ParentIdefId), (rotation, translation))
            continue
        mesh = object_mesh(geometry)
        if mesh is None:
            skipped_types[kind] += 1
            continue
        arrays = mesh_to_arrays(mesh)
        if arrays is None:
            continue
        members[str(file_object.Attributes.Id)] = ("mesh", arrays[0], arrays[1])
    return members, skipped_types


def collect_definition_ids(model):
    definition_ids = {}
    for definition in model.InstanceDefinitions:
        definition_ids[str(definition.Id)] = [str(object_id)
                                              for object_id in definition.GetObjectIds()]
    return definition_ids


def build_definition_cache(members, definition_ids):
    """Return {definition_id: (vertices, triangles)} in definition coordinates."""
    cache = {}

    def definition_arrays(definition_id, visiting):
        if definition_id in cache:
            return cache[definition_id]
        if definition_id in visiting or len(visiting) > MAX_DEFINITION_DEPTH:
            return None
        visiting.add(definition_id)
        chunks = []
        for object_id in definition_ids.get(definition_id, []):
            member = members.get(object_id)
            if member is None:
                continue
            if member[0] == "mesh":
                chunks.append((member[1], member[2]))
            else:
                child = definition_arrays(member[1], visiting)
                if child is None:
                    continue
                rotation, translation = member[2]
                moved_vertices = (child[0] @ rotation.T + translation).astype(np.float32)
                chunks.append((moved_vertices, child[1]))
        visiting.discard(definition_id)
        result = concatenate_arrays(chunks)
        cache[definition_id] = result
        return result

    for definition_id in definition_ids:
        definition_arrays(definition_id, set())
    gc.collect()
    return cache


# SECTION 4: model walk

def collect_layer_meshes(model, definition_cache, definition_names):
    """Group vertex/triangle arrays per layer, expanding block instances."""
    layer_vertices = {}
    layer_triangles = {}
    layer_objects = {}
    layer_object_counts = Counter()
    skipped_types = Counter()
    expanded_instance_count = 0
    missing_definition_count = 0

    def add_arrays(layer_index, arrays, object_kind, object_name, block_name):
        vertices, triangles = arrays
        layer_vertices.setdefault(layer_index, []).append(vertices)
        layer_triangles.setdefault(layer_index, []).append(triangles)
        layer_object_counts[layer_index] += 1
        layer_objects.setdefault(layer_index, []).append({
            "type": object_kind,
            "name": object_name or "",
            "block": block_name,
            "vertex_count": int(len(vertices)),
            "triangle_count": int(len(triangles)),
        })

    started_at = time.time()
    object_count = 0
    for file_object in model.Objects:
        object_count += 1
        if file_object.Attributes.IsInstanceDefinitionObject:
            continue
        layer_index = file_object.Attributes.LayerIndex
        mesh = object_mesh(file_object.Geometry)
        if mesh is not None:
            arrays = mesh_to_arrays(mesh)
            if arrays is not None:
                add_arrays(layer_index, arrays,
                           type(file_object.Geometry).__name__,
                           file_object.Attributes.Name, None)
        elif type(file_object.Geometry).__name__ == "InstanceReference":
            reference = file_object.Geometry
            definition = definition_cache.get(str(reference.ParentIdefId))
            if definition is None:
                missing_definition_count += 1
            else:
                rotation, translation = transform_matrix(reference.Xform)
                moved_vertices = (definition[0] @ rotation.T + translation).astype(np.float32)
                add_arrays(layer_index, (moved_vertices, definition[1]),
                           "BlockInstance", file_object.Attributes.Name,
                           definition_names.get(str(reference.ParentIdefId), ""))
                expanded_instance_count += 1
        else:
            skipped_types[type(file_object.Geometry).__name__] += 1
        if object_count % PROGRESS_EVERY == 0:
            print(f"  objects={object_count} elapsed={int(time.time() - started_at)}s",
                  flush=True)

    print(f"walk done: {object_count} objects in {int(time.time() - started_at)}s, "
          f"instances expanded={expanded_instance_count}")
    return (layer_vertices, layer_triangles, layer_objects, layer_object_counts,
            skipped_types, expanded_instance_count, missing_definition_count)


def merge_layer_arrays(layer_vertices, layer_triangles):
    merged = {}
    for layer_index, vertex_chunks in layer_vertices.items():
        merged[layer_index] = concatenate_arrays(
            list(zip(vertex_chunks, layer_triangles[layer_index])))
    return merged


# SECTION 5: normalisation and GLB build

def compute_bounds(merged_layers):
    minimum = np.array([np.inf, np.inf, np.inf])
    maximum = np.array([-np.inf, -np.inf, -np.inf])
    for vertices, _ in merged_layers.values():
        minimum = np.minimum(minimum, vertices.min(axis=0))
        maximum = np.maximum(maximum, vertices.max(axis=0))
    return minimum, maximum


def resolved_layer_color(layer, layer_index):
    """Return the RGB used for the layer: its own colour, or a group fallback.

    Revit and CAD imports often carry pure black layer colours, which would
    render the whole model as a silhouette. Those layers get a muted colour
    from GROUP_PALETTE so the viewer stays readable.
    """
    red, green, blue, alpha = layer.Color
    if max(red, green, blue) < DARK_CHANNEL_LIMIT:
        top_name = layer.FullPath.split("::")[0]
        base_color = DEFAULT_LAYER_COLOR
        for prefix, color in GROUP_PALETTE:
            if top_name.startswith(prefix):
                base_color = color
                break
        brightness = 0.9 + (layer_index % 4) * 0.05
        red, green, blue = (
            min(255, int(base_color[0] * brightness)),
            min(255, int(base_color[1] * brightness)),
            min(255, int(base_color[2] * brightness)),
        )
    return red, green, blue, alpha


def layer_color(layer, layer_index):
    red, green, blue, alpha = resolved_layer_color(layer, layer_index)
    return [
        srgb_to_linear(red),
        srgb_to_linear(green),
        srgb_to_linear(blue),
        alpha / 255.0,
    ]


def build_scene(merged_layers, model, layer_object_counts, layer_objects, center_mm):
    scene = trimesh.Scene()
    layer_metadata = []
    for layer_index in sorted(merged_layers.keys()):
        vertices, triangles = merged_layers[layer_index]
        vertices_m = ((vertices - center_mm) * SOURCE_UNIT_TO_METER).astype(np.float32)
        layer = model.Layers[layer_index]

        vertex_cursor = 0
        triangle_cursor = 0
        for record in layer_objects.get(layer_index, []):
            vertex_end = vertex_cursor + record["vertex_count"]
            object_vertices = vertices_m[vertex_cursor:vertex_end]
            record["vertex_start"] = int(vertex_cursor)
            record["triangle_start"] = int(triangle_cursor)
            record["layer"] = int(layer_index)
            record["layer_path"] = layer.FullPath
            record["node"] = f"layer_{layer_index}"
            if len(object_vertices):
                record["bbox_min"] = [float(value) for value in object_vertices.min(axis=0)]
                record["bbox_max"] = [float(value) for value in object_vertices.max(axis=0)]
            else:
                record["bbox_min"] = [0.0, 0.0, 0.0]
                record["bbox_max"] = [0.0, 0.0, 0.0]
            vertex_cursor = vertex_end
            triangle_cursor += record["triangle_count"]
        red, green, blue, _ = resolved_layer_color(layer, layer_index)
        material = trimesh.visual.material.PBRMaterial(
            baseColorFactor=layer_color(layer, layer_index),
            metallicFactor=0.0,
            roughnessFactor=0.85,
        )
        material.doubleSided = True
        mesh = trimesh.Trimesh(vertices=vertices_m, faces=triangles,
                               process=False, validate=False)
        mesh.visual = trimesh.visual.TextureVisuals(material=material)
        node_name = f"layer_{layer_index}"
        scene.add_geometry(mesh, node_name=node_name, geom_name=node_name)
        layer_metadata.append({
            "index": layer_index,
            "path": layer.FullPath,
            "name": layer.Name,
            "depth": layer.FullPath.count("::"),
            "color": "#{:02x}{:02x}{:02x}".format(red, green, blue),
            "visible": bool(layer.Visible),
            "object_count": int(layer_object_counts[layer_index]),
            "triangle_count": int(len(triangles)),
            "node": node_name,
        })
    return scene, layer_metadata


def glb_triangle_count(glb_path):
    """Read the GLB header and add up the index counts (no full load)."""
    with open(glb_path, "rb") as file_handle:
        header = file_handle.read(20)
        magic, version, total_length = struct.unpack_from("<III", header, 0)
        if magic != 0x46546C67:
            return None
        json_length, json_type = struct.unpack_from("<II", header, 12)
        gltf = json.loads(file_handle.read(json_length))
    accessors = gltf.get("accessors", [])
    triangle_total = 0
    for mesh in gltf.get("meshes", []):
        for primitive in mesh.get("primitives", []):
            index_accessor = primitive.get("indices")
            if index_accessor is None:
                continue
            triangle_total += accessors[index_accessor]["count"] // 3
    return triangle_total


# SECTION 6: main flow

def main():
    arguments = parse_arguments()
    file_path = os.path.abspath(arguments.source)
    output_dir = os.path.abspath(arguments.output_dir)
    os.makedirs(output_dir, exist_ok=True)

    started_at = time.time()
    print(f"reading {file_path}", flush=True)
    model = rhino3dm.File3dm.Read(file_path)
    if model is None:
        raise SystemExit("rhino3dm could not read this file.")
    print(f"loaded in {int(time.time() - started_at)}s", flush=True)

    print("collecting block definitions ...", flush=True)
    members, definition_skipped = collect_definition_members(model)
    definition_ids = collect_definition_ids(model)
    definition_names = {str(definition.Id): definition.Name
                        for definition in model.InstanceDefinitions}
    definition_cache = build_definition_cache(members, definition_ids)
    del members
    gc.collect()
    print(f"block definitions cached: {len(definition_cache)}", flush=True)

    (layer_vertices, layer_triangles, layer_objects, layer_object_counts, skipped_types,
     expanded_instance_count, missing_definition_count) = collect_layer_meshes(
        model, definition_cache, definition_names)
    del definition_cache
    gc.collect()
    merged_layers = merge_layer_arrays(layer_vertices, layer_triangles)
    del layer_vertices, layer_triangles
    gc.collect()

    minimum_mm, maximum_mm = compute_bounds(merged_layers)
    center_mm = (minimum_mm + maximum_mm) / 2.0
    print(f"mesh bounds (mm): min={minimum_mm.round(1)} max={maximum_mm.round(1)}", flush=True)

    scene, layer_metadata = build_scene(merged_layers, model, layer_object_counts,
                                        layer_objects, center_mm)
    del merged_layers
    gc.collect()

    object_records = []
    for layer_index in sorted(layer_objects.keys()):
        object_records.extend(layer_objects[layer_index])
    for object_id, record in enumerate(object_records):
        record["id"] = object_id
    print(f"object records: {len(object_records)}", flush=True)

    triangle_total = sum(item["triangle_count"] for item in layer_metadata)
    glb_path = os.path.join(output_dir, "model.glb")
    print("writing GLB ...", flush=True)
    export_started_at = time.time()
    glb_bytes = scene.export(file_type="glb")
    with open(glb_path, "wb") as file_handle:
        file_handle.write(glb_bytes)
    glb_size = os.path.getsize(glb_path)
    print(f"GLB written in {int(time.time() - export_started_at)}s: "
          f"{glb_size / 1024 ** 2:.1f} MB")

    objects_path = os.path.join(output_dir, "objects.json")
    with open(objects_path, "w", encoding="utf-8") as file_handle:
        json.dump({"total": len(object_records), "objects": object_records},
                  file_handle, separators=(",", ":"), ensure_ascii=False)
    objects_size = os.path.getsize(objects_path)
    print(f"objects.json: {objects_size / 1024 ** 2:.2f} MB ({len(object_records)} objects)")

    for name, count in definition_skipped.items():
        skipped_types[name] += count

    scene_report = {
        "source_file": os.path.basename(file_path),
        "source_size_bytes": os.path.getsize(file_path),
        "source_units": "millimetres",
        "scale_to_meters": SOURCE_UNIT_TO_METER,
        "up_axis": "Rhino Z-up; the viewer rotates the model to three.js Y-up",
        "center_mm": [float(value) for value in center_mm],
        "bounds_m": {
            "min": [float(value) for value in (minimum_mm - center_mm) * SOURCE_UNIT_TO_METER],
            "max": [float(value) for value in (maximum_mm - center_mm) * SOURCE_UNIT_TO_METER],
            "size": [float(value) for value in (maximum_mm - minimum_mm) * SOURCE_UNIT_TO_METER],
        },
        "totals": {
            "layers_with_mesh": len(layer_metadata),
            "objects": int(sum(layer_object_counts.values())),
            "object_records": len(object_records),
            "objects_json_bytes": objects_size,
            "instances_expanded": int(expanded_instance_count),
            "triangles": int(triangle_total),
            "glb_bytes": glb_size,
            "glb_triangles_verified": glb_triangle_count(glb_path),
        },
        "skipped": {
            "by_type": dict(skipped_types),
            "missing_definitions": missing_definition_count,
        },
        "layers": layer_metadata,
    }
    json_path = os.path.join(output_dir, "scene.json")
    with open(json_path, "w", encoding="utf-8") as file_handle:
        json.dump(scene_report, file_handle, indent=2, ensure_ascii=False)

    print(f"layers with mesh: {len(layer_metadata)}  "
          f"objects: {sum(layer_object_counts.values())}  "
          f"triangles: {triangle_total}")
    print(f"skipped: {dict(skipped_types.most_common(5))}")
    print(f"viewer data: {json_path}")
    print(f"total: {int(time.time() - started_at)}s")


if __name__ == "__main__":
    sys.exit(main())

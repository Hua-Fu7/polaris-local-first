"""生成桌宠「每帧头部位置」数据，供帽子跟随使用。

第一版用整帧 alpha bbox，结果量到的是道具（键盘、屏幕、彩带），帽子飞得到处都是。
现在按**螃蟹体色**过滤再取 bbox：道具是灰/黑/黄/青这些颜色，不会被算进来。
"""
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
BASE = ROOT / "public/pets/clawd"
OUT = ROOT / "src/ui/worlds/chat/clawdPetBob.generated.ts"

# 与 ClawdPet.tsx 的 MOOD_SRC 对齐
MOODS = {
    "idle": "clawd-idle.webp",
    "thinking": "clawd-thinking.webp",
    "typing": "clawd-typing.webp",
    "happy": "clawd-happy.webp",
    "error": "clawd-error.webp",
    "notification": "clawd-notification.webp",
    "sleeping": "clawd-sleeping.webp",
    "building": "clawd-building.webp",
    "carrying": "clawd-carrying.webp",
    "conducting": "clawd-conducting.webp",
    "debugger": "clawd-debugger.webp",
    "juggling": "clawd-juggling.webp",
    "sweeping": "clawd-sweeping.webp",
    "bubble": "clawd-bubble.webp",
    "idle-reading": "clawd-idle-reading.webp",
    "headphones-groove": "clawd-headphones-groove.webp",
    "react-annoyed": "clawd-react-annoyed.webp",
    "react-double-jump": "clawd-react-double-jump.webp",
}

# 螃蟹体色：约 (224, 139, 112)；给足容差，阴影/高光也算进来
BODY_R, BODY_G, BODY_B = 224, 139, 112
TOLERANCE = 46
BODY_WIDTH_REF = 0


def body_bbox(frame: Image.Image):
    """取「最大连通块」的 bbox：螃蟹本体是最大的一块，键盘/屏幕/彩带都是分开的。"""
    rgba = frame.convert("RGBA")
    px = rgba.load()
    width, height = rgba.size
    step = 2
    cols = width // step
    rows = height // step

    mask = bytearray(cols * rows)
    for row in range(rows):
        for col in range(cols):
            r, g, b, a = px[col * step, row * step]
            if a < 40:
                continue
            if abs(r - BODY_R) <= TOLERANCE and abs(g - BODY_G) <= TOLERANCE and abs(b - BODY_B) <= TOLERANCE:
                mask[row * cols + col] = 1

    candidates = []
    seen = bytearray(cols * rows)
    for start in range(cols * rows):
        if not mask[start] or seen[start]:
            continue
        stack = [start]
        seen[start] = 1
        area = 0
        min_x = min_y = 10 ** 6
        max_x = max_y = -1
        while stack:
            current = stack.pop()
            row, col = divmod(current, cols)
            area += 1
            if col < min_x: min_x = col
            if col > max_x: max_x = col
            if row < min_y: min_y = row
            if row > max_y: max_y = row
            for dr, dc in ((1, 0), (-1, 0), (0, 1), (0, -1)):
                nr, nc = row + dr, col + dc
                if nr < 0 or nr >= rows or nc < 0 or nc >= cols:
                    continue
                index = nr * cols + nc
                if mask[index] and not seen[index]:
                    seen[index] = 1
                    stack.append(index)
        candidates.append(((max_x - min_x + 1) * step, area, (min_x * step, min_y * step, (max_x + 1) * step, (max_y + 1) * step)))

    if not candidates:
        return None
    # 螃蟹本体宽度稳定（约 100px）：优先挑宽度接近参照的块，避免挑到彩带/光点
    target = BODY_WIDTH_REF or 100
    candidates.sort(key=lambda item: (abs(item[0] - target), -item[1]))
    return candidates[0][2]


# 先用 idle 第 0 帧测出螃蟹标准宽度
_first = Image.open(BASE / MOODS["idle"])
_first.seek(0)
_seed = body_bbox(_first.convert("RGBA"))
BODY_WIDTH_REF = (_seed[2] - _seed[0]) if _seed else 100
print(f"参照宽度：{BODY_WIDTH_REF}px")

tracks = {}
reference = None

for mood, filename in MOODS.items():
    path = BASE / filename
    if not path.exists():
        print(f"跳过（缺文件）{mood}")
        continue
    im = Image.open(path)
    frames = getattr(im, "n_frames", 1)
    samples = []
    elapsed = 0
    for index in range(frames):
        im.seek(index)
        duration = im.info.get("duration", 80) or 80
        box = body_bbox(im.convert("RGBA"))
        if box:
            top = box[1]
            center = (box[0] + box[2]) / 2
        else:
            top, center = None, None
        samples.append({"t": elapsed, "top": top, "cx": center})
        elapsed += duration
    tracks[mood] = {"duration": elapsed, "samples": samples}
    if mood == "idle":
        reference = samples[0]

ref_top = reference["top"]
ref_cx = reference["cx"]
print(f"参照（idle 第 0 帧）：头顶 y={ref_top}，中心 x={ref_cx:.1f}")

lines = [
    "/**",
    " * 自动生成，请勿手改：polaris/tools/gen-pet-bob.py 按螃蟹体色逐帧算头顶位置。",
    " * 单位是桌宠画布像素（302x300），相对 idle 第 0 帧的头顶/中心。",
    " * 组件按 120/302 换算成显示像素，用 Web Animations 跟动画同步。",
    " */",
    "",
    "export type PetBobFrame = { t: number; x: number; y: number };",
    "export type PetBobTrack = { duration: number; frames: PetBobFrame[] };",
    "",
    "export const PET_BOB: Record<string, PetBobTrack> = {",
]

for mood, track in tracks.items():
    frames = []
    for item in track["samples"]:
        if item["top"] is None:
            frames.append({"t": item["t"], "x": 0.0, "y": 0.0})
            continue
        frames.append({
            "t": item["t"],
            "x": round(item["cx"] - ref_cx, 1),
            "y": round(item["top"] - ref_top, 1),
        })
    compact = []
    for item in frames:
        if compact and compact[-1]["x"] == item["x"] and compact[-1]["y"] == item["y"]:
            continue
        compact.append(item)
    body = ", ".join("{ t: %d, x: %s, y: %s }" % (f["t"], f["x"], f["y"]) for f in compact)
    ys = [f["y"] for f in frames]
    print(f"{mood}: {len(frames)} 帧, y 范围 {min(ys)}..{max(ys)}")
    lines.append(f"  '{mood}': {{ duration: {track['duration']}, frames: [{body}] }},")

lines.append("};")
lines.append("")
OUT.write_text("\n".join(lines), encoding="utf-8")
print(f"写出 {OUT}")

"""把装扮烘进每一帧：产出「螃蟹+帽子」的整段动画。

为什么这么做：帽子作为独立图层只能钉在容器上，螃蟹一动就浮空；
按帧算偏移又容易跟播放不同步（看起来乱飘）。直接把帽子画进每一帧，
播放时就是一个整体，天然同步。

用法：
    python tools/bake-pet-outfits.py            # 全部烘
    python tools/bake-pet-outfits.py idle       # 只烘某个动画（调试用）
"""
from pathlib import Path
import sys

import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
PET = ROOT / "public/pets/clawd"
ACC = PET / "accessories"
OUT = PET / "outfits"

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

# 每个装扮：宽度占画布百分比 + 帽子底边压进头顶多少画布像素（负数=浮在上方）
# 这样对齐不再依赖手调的百分比，帽子会稳定压在头顶上
ACCESSORIES = {
    "cowboy-hat": {"width": 34, "overlap": 8},
    "western-cowboy-hat": {"width": 36, "overlap": 8},
    "top-hat": {"width": 26, "overlap": 8},
    "santa-hat": {"width": 34, "overlap": 4},
    "party-hat": {"width": 26, "overlap": 3},
    "pumpkin-hat": {"width": 30, "overlap": 14},
    "wizard-hat": {"width": 30, "overlap": 3},
    "halo": {"width": 26, "overlap": -12},
    "cigarette": {"width": 9, "mouth": True, "left": 59},
}

CANVAS_W, CANVAS_H = 302, 300
REF_TOP, REF_CX = 208, 150  # idle 第 0 帧
BODY_RGB = np.array([224, 139, 112])
TOL = 46


def body_reference(frame: Image.Image):
    """用 numpy 找「体色主体」的头顶与中心。

    不数连通块（纯 Python 太慢）：先按体色过滤，再用列投影圈出主体范围。
    道具颜色各异，且多数在身体上下方，投影法足够稳。
    """
    arr = np.asarray(frame.convert("RGBA"), dtype=np.int16)
    rgb = arr[..., :3]
    alpha = arr[..., 3]
    mask = (np.abs(rgb - BODY_RGB).max(axis=2) <= TOL) & (alpha > 40)

    columns = mask.sum(axis=0)
    height = mask.shape[0]

    runs = []
    start = None
    for x in range(mask.shape[1]):
        if columns[x] > height * 0.02:
            if start is None:
                start = x
        elif start is not None:
            runs.append((start, x))
            start = None
    if start is not None:
        runs.append((start, mask.shape[1]))

    if not runs:
        return REF_TOP, REF_CX

    def score(run):
        width = run[1] - run[0]
        center = (run[0] + run[1]) / 2
        return abs(center - 150) + abs(width - 100) * 0.5

    x0, x1 = min(runs, key=score)
    body = mask[:, x0:x1]
    row_profile = body.sum(axis=1)
    rows_with_body = np.where(row_profile > max(2, (x1 - x0) * 0.15))[0]
    top = int(rows_with_body[0]) if rows_with_body.size else REF_TOP
    return top, (x0 + x1) / 2


def load_hat(name: str) -> Image.Image:
    hat = Image.open(ACC / f"{name}.png").convert("RGBA")
    bbox = hat.getchannel("A").point(lambda v: 255 if v > 8 else 0).getbbox()
    return hat.crop(bbox)


def place(hat: Image.Image, spec: dict, body_top: float, body_cx: float):
    target_w = max(6, round(spec["width"] / 100 * CANVAS_W))
    ratio = target_w / hat.width
    scaled = hat.resize((target_w, max(1, round(hat.height * ratio))), Image.LANCZOS)

    center_x = spec.get("left", 50) / 100 * CANVAS_W + (body_cx - REF_CX)
    x = round(center_x - scaled.width / 2)

    if spec.get("mouth"):
        # 烟是竖着的：底边落在嘴边（头顶往下 32 像素左右）
        mouth_y = body_top + 32
        y = round(mouth_y - scaled.height)
    else:
        y = round(body_top - scaled.height + spec["overlap"])
    return x, y, scaled


def bake(mood: str, filename: str):
    source = Image.open(PET / filename)
    frames = []
    durations = []
    for index in range(getattr(source, "n_frames", 1)):
        source.seek(index)
        frames.append(source.convert("RGBA").copy())
        durations.append(source.info.get("duration", 80) or 80)

    body = [body_reference(frame) for frame in frames]

    for hat_name, spec in ACCESSORIES.items():
        hat = load_hat(hat_name)
        composed = []
        for frame, (top, cx) in zip(frames, body):
            canvas = frame.copy()
            x, y, scaled = place(hat, spec, top, cx)
            canvas.alpha_composite(scaled, (x, y))
            composed.append(canvas)
        target = OUT / f"clawd-{mood}--{hat_name}.webp"
        composed[0].save(
            target,
            save_all=True,
            append_images=composed[1:],
            duration=durations,
            loop=0,
            quality=82,
            method=4,
        )
        print(f"  {target.name}  {target.stat().st_size // 1024} KB", flush=True)


def write_manifest():
    keys = sorted(
        path.stem.replace("clawd-", "", 1)
        for path in OUT.glob("clawd-*--*.webp")
    )
    target = ROOT / "src/ui/worlds/chat/clawdOutfits.generated.ts"
    lines = [
        "/** 自动生成，请勿手改：polaris/tools/bake-pet-outfits.py 烘焙完会重写。 */",
        "",
        "export const PET_OUTFIT_KEYS: readonly string[] = [",
        *[f"  '{key}'," for key in keys],
        "];",
        "",
    ]
    target.write_text("\n".join(lines), encoding="utf-8")
    print(f"清单写入 {target}（{len(keys)} 项）")


def main():
    only = sys.argv[1] if len(sys.argv) > 1 else None
    OUT.mkdir(parents=True, exist_ok=True)
    for mood, filename in MOODS.items():
        if only and mood != only:
            continue
        if not (PET / filename).exists():
            print(f"跳过 {mood}（缺素材）")
            continue
        print(f"烘焙 {mood}", flush=True)
        bake(mood, filename)
    write_manifest()


if __name__ == "__main__":
    main()

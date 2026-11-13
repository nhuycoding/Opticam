"""Simple polygon geometry for the store boundary, including concave plans."""
import math


def segment_distance(point, a, b):
    dx, dy = b[0] - a[0], b[1] - a[1]
    length = dx * dx + dy * dy
    t = max(0, min(1, ((point[0] - a[0]) * dx + (point[1] - a[1]) * dy) / length)) if length else 0
    return math.hypot(point[0] - a[0] - t * dx, point[1] - a[1] - t * dy)


def point_in_floor(point, polygon):
    inside = False
    for i, a in enumerate(polygon):
        b = polygon[(i + 1) % len(polygon)]
        if segment_distance(point, a, b) < 1e-7:
            return True
        if (a[1] > point[1]) != (b[1] > point[1]) and point[0] < (b[0] - a[0]) * (point[1] - a[1]) / (b[1] - a[1]) + a[0]:
            inside = not inside
    return inside


def segment_in_floor(a, b, polygon):
    if not point_in_floor(a, polygon) or not point_in_floor(b, polygon):
        return False
    dx, dy = b[0] - a[0], b[1] - a[1]
    times = [0, 1]
    for i, c in enumerate(polygon):
        d = polygon[(i + 1) % len(polygon)]
        ex, ey = d[0] - c[0], d[1] - c[1]
        denominator = dx * ey - dy * ex
        if abs(denominator) < 1e-10:
            continue
        t = ((c[0] - a[0]) * ey - (c[1] - a[1]) * ex) / denominator
        u = ((c[0] - a[0]) * dy - (c[1] - a[1]) * dx) / denominator
        if 0 < t < 1 and 0 <= u <= 1:
            times.append(t)
    times.sort()
    return all(point_in_floor((a[0] + (lo + hi) / 2 * dx, a[1] + (lo + hi) / 2 * dy), polygon)
               for lo, hi in zip(times, times[1:]))


def boundary_anchors(polygon, step):
    result = set()
    for i, a in enumerate(polygon):
        b = polygon[(i + 1) % len(polygon)]
        count = max(1, math.ceil(math.hypot(b[0] - a[0], b[1] - a[1]) / step))
        for j in range(count + 1):
            # Keep projection precision on sloping walls.
            result.add((a[0] + (b[0] - a[0]) * j / count, a[1] + (b[1] - a[1]) * j / count))
    return sorted(result)


def validate_polygon(polygon, width, height):
    if polygon is None:
        return
    if any(not 0 <= x <= width or not 0 <= y <= height for x, y in polygon):
        raise ValueError("floor polygon must be inside layout bounds")
    area_twice = sum(a[0] * polygon[(i + 1) % len(polygon)][1] - a[1] * polygon[(i + 1) % len(polygon)][0]
                     for i, a in enumerate(polygon))
    if abs(area_twice) < 2:
        raise ValueError("floor polygon area must be at least one square meter")

    def orient(a, b, c):
        return (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0])

    for i, a in enumerate(polygon):
        b = polygon[(i + 1) % len(polygon)]
        if math.dist(a, b) < .01:
            raise ValueError("floor polygon vertices must be distinct")
        for j in range(i + 1, len(polygon)):
            if j == i + 1 or (i == 0 and j == len(polygon) - 1):
                continue
            c, d = polygon[j], polygon[(j + 1) % len(polygon)]
            overlaps = (max(min(a[0], b[0]), min(c[0], d[0])) <= min(max(a[0], b[0]), max(c[0], d[0]))
                        and max(min(a[1], b[1]), min(c[1], d[1])) <= min(max(a[1], b[1]), max(c[1], d[1])))
            if overlaps and orient(a, b, c) * orient(a, b, d) <= 0 and orient(c, d, a) * orient(c, d, b) <= 0:
                raise ValueError("floor polygon cannot self-intersect")

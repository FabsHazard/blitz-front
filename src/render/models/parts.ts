import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

/** Builds a single low-poly mesh out of colored primitives, with flat shading. */
export class ModelBuilder {
  private parts: THREE.BufferGeometry[] = [];

  private add(geo: THREE.BufferGeometry, color: number | string, x: number, y: number, z: number,
    rotY = 0, rotX = 0, rotZ = 0): this {
    const g = geo.index ? geo.toNonIndexed() : geo;
    g.deleteAttribute('uv');
    if (rotX || rotY || rotZ) g.applyMatrix4(new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(rotX, rotY, rotZ)));
    g.translate(x, y, z);
    g.computeVertexNormals();
    const c = new THREE.Color(color);
    const count = g.getAttribute('position').count;
    const colors = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) colors.set([c.r, c.g, c.b], i * 3);
    g.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    this.parts.push(g);
    return this;
  }

  box(w: number, h: number, d: number, color: number | string, x = 0, y = 0, z = 0, rotY = 0): this {
    return this.add(new THREE.BoxGeometry(w, h, d), color, x, y + h / 2, z, rotY);
  }

  cyl(rTop: number, rBot: number, h: number, sides: number, color: number | string,
    x = 0, y = 0, z = 0): this {
    return this.add(new THREE.CylinderGeometry(rTop, rBot, h, sides), color, x, y + h / 2, z);
  }

  /** A cylinder lying along the local X axis, for barrels. */
  barrel(r: number, length: number, color: number | string, x = 0, y = 0, z = 0): this {
    return this.add(new THREE.CylinderGeometry(r, r, length, 5), color, x + length / 2, y, z, 0, 0, Math.PI / 2);
  }

  cone(r: number, h: number, sides: number, color: number | string, x = 0, y = 0, z = 0): this {
    return this.add(new THREE.ConeGeometry(r, h, sides), color, x, y + h / 2, z);
  }

  ball(r: number, color: number | string, x = 0, y = 0, z = 0, detail = 0): this {
    return this.add(new THREE.IcosahedronGeometry(r, detail), color, x, y, z);
  }

  build(): THREE.BufferGeometry {
    const merged = mergeGeometries(this.parts, false);
    if (!merged) throw new Error('Could not merge model parts');
    return merged;
  }
}

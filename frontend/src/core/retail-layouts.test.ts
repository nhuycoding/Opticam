import { describe, expect, it } from 'vitest';
import { PRESETS, withManualCams } from '../data/presets';
import { addObstacle, resizeRoom } from './editor';
import { floorArea, floorOutline, footprintFits, pointInFloor, projectToSegment, segmentInFloor } from './footprint';
import { obsPoly, satCollide, wallAnchors, snapToWall } from './geometry';
import { normalizeLayout, parseBundle, exportBundle } from './io';
import { buildZones, evaluate, ppmAt } from './optics';
import { greedyPlace, makeCamera } from './optimizer';
import { canPlacePerson } from './person';
import { toApiPayload } from './api';

const retail = PRESETS.slice(3);
const lShape: [number,number][] = [[0,0],[10,0],[10,4],[6,4],[6,9],[0,9]];

describe('Vietnamese convenience store templates', () => {
  it('adds exactly four templates with the intended floor areas', () => {
    expect(retail).toHaveLength(4);
    expect(retail.map(floorArea)).toEqual([72,78,70,67.5]);
  });
  for (const layout of retail) describe(layout.name, () => {
    it('has non-overlapping fixtures inside the actual floor', () => {
      for (const obstacle of layout.obstacles) expect(footprintFits(obstacle, layout.floorPolygon), obstacle.id).toBe(true);
      for (let i=0;i<layout.obstacles.length;i++) for(let j=i+1;j<layout.obstacles.length;j++) {
        expect(satCollide(obsPoly(layout.obstacles[i]),obsPoly(layout.obstacles[j])), `${layout.obstacles[i].id} overlaps ${layout.obstacles[j].id}`).toBe(false);
      }
    });
    it('keeps wall shelves shallow and next to a real wall', () => {
      const polygon=floorOutline(layout);
      const shelves=layout.obstacles.filter(o=>o.fixture==='wall-shelf');
      expect(shelves.length).toBeGreaterThanOrEqual(2);
      for (const shelf of shelves) {
        const center: [number,number] = [shelf.x+shelf.w/2,shelf.y+shelf.h/2];
        const distance=Math.min(...polygon.map((a,i)=>projectToSegment(center,a,polygon[(i+1)%polygon.length]).distance));
        expect(Math.min(shelf.w,shelf.h)).toBeLessThanOrEqual(.5);
        expect(distance, shelf.id).toBeLessThan(.4);
      }
    });
    it('preserves the purpose-specific installation cameras when loading', () => {
      expect(withManualCams(layout).cameras).toEqual(layout.cameras);
      expect(layout.cameras.length).toBeGreaterThanOrEqual(4);
      for (const camera of layout.cameras) {
        expect(camera.target).toBeTruthy();
        expect(pointInFloor([camera.x,camera.y],floorOutline(layout))).toBe(true);
      }
    });
    it('has a walkable continuous shopping route', () => {
      for(const route of layout.walkways ?? [])for(let i=1;i<route.points.length;i++) {
        const a=route.points[i-1], b=route.points[i];
        for(let t=0;t<=1;t+=.025) {
          const x=a[0]+t*(b[0]-a[0]), y=a[1]+t*(b[1]-a[1]);
          expect(canPlacePerson(x,y,layout.widthM,layout.heightM,layout.obstacles,layout.floorPolygon), `${route.label} blocked at ${x.toFixed(2)}, ${y.toFixed(2)}`).toBe(true);
        }
      }
    });
    it('round trips boundary, fixture types, and camera roles through project files', () => {
      const score=evaluate(layout,buildZones(layout)).score;
      const loaded=parseBundle(exportBundle(layout,score));
      expect(loaded.floorPolygon).toEqual(layout.floorPolygon);
      expect(loaded.obstacles).toEqual(layout.obstacles);
      expect(loaded.cameras).toEqual(layout.cameras);
      expect(loaded.walkways).toEqual(layout.walkways);
      expect(toApiPayload(layout,buildZones(layout),4).layout.floorPolygon).toEqual(layout.floorPolygon);
    });
    it('optimizes using cameras on the actual boundary', () => {
      const polygon=floorOutline(layout);
      const cameras=greedyPlace(layout,buildZones(layout),2,true,{anchorStep:3,angleStep:45});
      expect(cameras.length).toBe(2);
      expect(cameras.every(c=>pointInFloor([c.x,c.y],polygon))).toBe(true);
      expect(cameras.every(c=>polygon.some((a,i)=>projectToSegment([c.x,c.y],a,polygon[(i+1)%polygon.length]).distance<1e-6))).toBe(true);
    });
  });
});

describe('Concave floor geometry', () => {
  const layout=retail[2];
  it('excludes the missing corner from coverage, people, and shelf placement', () => {
    expect(pointInFloor([8,7],lShape)).toBe(false);
    expect(canPlacePerson(8,7,10,9,[],lShape)).toBe(false);
    expect(buildZones(layout).filter(c=>c.cx>6&&c.cy>4).every(c=>c.solid)).toBe(true);
    expect(footprintFits({id:'bad',type:'shelf',label:'bad',x:5,y:3,w:3,h:3,angle:0,elev:1},lShape)).toBe(false);
  });
  it('blocks a sightline that crosses the exterior and reenters the other wing', () => {
    expect(segmentInFloor([9,3],[5,8],lShape)).toBe(false);
    expect(ppmAt(makeCamera('A',9,3,135),5,8,[],1.6,lShape)).toBe(0);
    expect(ppmAt({...makeCamera('B',3,0,90),fov:120},3,8,[],1.6,lShape)).toBeGreaterThan(0);
  });
  it('creates anchors and snaps cameras to the inside corner walls', () => {
    expect(wallAnchors(10,9,.5,lShape)).toContainEqual([6,6]);
    expect(snapToWall(7,6,10,9,.5,lShape)).toEqual([6,6]);
  });
  it('adds a wall shelf attached to the polygon boundary', () => {
    const empty={...layout,obstacles:[]};
    const next=addObstacle(empty,'shelf','wall-shelf');
    expect(next).not.toBeNull();
    expect(next!.obstacles[0].fixture).toBe('wall-shelf');
    expect(footprintFits(next!.obstacles[0],lShape)).toBe(true);
  });
  it('rejects self intersecting or out-of-bounds polygons on import', () => {
    expect(()=>normalizeLayout({...layout, floorPolygon:[[0,0],[10,9],[10,0],[0,9]]})).toThrow();
    expect(()=>normalizeLayout({...layout, floorPolygon:[[0,0],[11,0],[0,9]]})).toThrow();
  });
  it('scales a polygon when changing room dimensions', () => {
    const result=resizeRoom({...layout,obstacles:[],cameras:[]},12,10);
    expect(floorArea(result)).toBeCloseTo(70*1.2*10/9,1);
    expect(result.walkways).toBeUndefined();
  });
});

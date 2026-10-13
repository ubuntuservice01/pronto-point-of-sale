import test from 'node:test';
import assert from 'node:assert/strict';
import {landscapeConstraints,visibleCameraCrop,allowDetectedBarcode} from '../src/camera-utils.js';
test('Scanner prefers rear-facing HD landscape video without capturing audio',()=>{
 const c=landscapeConstraints();
 assert.equal(c.audio,false);
 assert.equal(c.video.facingMode.ideal,'environment');
 assert.equal(c.video.width.ideal,1280);
 assert.equal(c.video.height.ideal,720);
 assert.equal(c.video.aspectRatio.ideal,16/9);
 assert.equal(landscapeConstraints('user').video.facingMode.ideal,'user');
});
test('Portrait camera stream is cropped to the landscape preview without side bars',()=>{
 const crop=visibleCameraCrop(720,1280,640,360);
 assert.ok(crop);
 assert.equal(crop.width,720);
 assert.equal(crop.height,405);
 assert.equal(crop.x,0);
 assert.ok(crop.y>0);
});
test('Landscape stream and invalid dimensions are handled',()=>{
 assert.deepEqual(visibleCameraCrop(1280,720,640,360),{x:0,y:0,width:1280,height:720});
 assert.deepEqual(visibleCameraCrop(1920,1080,640,360),{x:0,y:0,width:1920,height:1080});
 assert.equal(visibleCameraCrop(0,720,640,360),null);
});
test('Barcode scanner does not repeatedly charge for the same code on consecutive frames',()=>{
 assert.equal(allowDetectedBarcode(null,'789123',1000),true);
 assert.equal(allowDetectedBarcode({code:'789123',at:1000},'789123',1600),false);
 assert.equal(allowDetectedBarcode({code:'789123',at:1000},'789123',3499),false);
 assert.equal(allowDetectedBarcode({code:'789123',at:1000},'789123',3500),true);
 assert.equal(allowDetectedBarcode({code:'789123',at:1000},'123',1400),true);
 assert.equal(allowDetectedBarcode({code:'789123',at:1000},'',1600),false);
});

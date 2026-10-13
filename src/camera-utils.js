/** Camera preferences are hints: browsers control the physical sensor orientation. */
export function landscapeConstraints(facing='environment'){
 return {audio:false,video:{facingMode:{ideal:facing},width:{ideal:1280},height:{ideal:720},aspectRatio:{ideal:16/9}}};
}
/** Crop the detector's input to the exact centre shown by a 16:9 object-fit:cover preview. */
export function visibleCameraCrop(videoWidth,videoHeight,frameWidth,frameHeight){
 if([videoWidth,videoHeight,frameWidth,frameHeight].some(v=>!Number.isFinite(v)||v<=0))return null;
 const sourceRatio=videoWidth/videoHeight,targetRatio=frameWidth/frameHeight;
 if(sourceRatio>targetRatio){const width=videoHeight*targetRatio;return {x:(videoWidth-width)/2,y:0,width,height:videoHeight};}
 const height=videoWidth/targetRatio;
 return {x:0,y:(videoHeight-height)/2,width:videoWidth,height};
}
/** Stop repeated detections of the same barcode while it stays in the viewfinder. */
export function allowDetectedBarcode(last,code,now,repeatDelay=2500){
 if(!code||typeof code!=='string')return false;
 if(last?.code===code&&now-last.at<repeatDelay)return false;
 return true;
}

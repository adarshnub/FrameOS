/** Manual controls share the Studio transaction boundary with timeline edits. */
export const manualEffectsJavaScript = String.raw`
const manualEffectDefinitions={
 'frameos.video.chroma-key':{name:'Chroma key',defaults:{color:'#00ff00',tolerance:0.15},fields:[{key:'color',label:'Key color',type:'color'},{key:'tolerance',label:'Tolerance',min:0,max:1,step:0.01}]},
 'frameos.video.gaussian-blur':{name:'Gaussian blur',defaults:{sigma:5},fields:[{key:'sigma',label:'Blur radius',min:0,max:100,step:0.5}]},
 'frameos.video.vignette':{name:'Vignette',defaults:{strength:0.5},fields:[{key:'strength',label:'Strength',min:0,max:1,step:0.01}]},
 'frameos.color.primary':{name:'Primary color',defaults:{exposureStops:0,contrast:1,saturation:1},fields:[{key:'exposureStops',label:'Exposure (stops)',min:-3,max:3,step:0.1},{key:'contrast',label:'Contrast',min:0,max:4,step:0.05},{key:'saturation',label:'Saturation',min:0,max:3,step:0.05}]}
};
const manualKeyframeProperties=new Set(['transform.positionX','transform.positionY','transform.scaleX','transform.scaleY','transform.rotation','transform.opacity']);
function manualButton(label,action,effectId){const button=document.createElement('button');button.type='button';button.textContent=label;button.dataset.manualAction=action;button.dataset.effectId=effectId;return button;}
function renderManualControls(){
 const chosen=selection(),item=chosen?.item,editable=!!chosen&&!chosen.track.locked&&!item.locked;
 const effectsVisible=editable&&item.type==='clip'&&chosen.track.kind==='video';
 $('manual-effects').hidden=!effectsVisible;$('manual-title').hidden=!(editable&&item.type==='title');
 $('manual-animation').hidden=!(editable&&(item.type==='title'||item.type==='clip'&&chosen.track.kind==='video'));
 if(!item)return;
 if(effectsVisible){
  const available=new Set(state.capabilities.filter(c=>c.available).map(c=>c.id));
  const select=$('manual-effect-type');select.replaceChildren(new Option('Choose an effect',''));
  for(const [id,definition] of Object.entries(manualEffectDefinitions))if(available.has(id))select.add(new Option(definition.name,id));
  $('manual-effect-add').disabled=select.options.length<2;
  const list=$('manual-effect-list');list.replaceChildren();
  for(const [index,effect] of item.effects.entries()){
   const definition=manualEffectDefinitions[effect.capabilityId];
   const card=document.createElement('article');card.className='manual-effect-card';card.dataset.effectId=effect.id;
   const heading=document.createElement('div');heading.className='manual-effect-heading';
   const title=document.createElement('strong');title.textContent=definition?.name||effect.capabilityId;
   const stateLabel=document.createElement('small');stateLabel.textContent=effect.enabled?'Active':'Bypassed';heading.append(title,stateLabel);card.append(heading);
   if(definition)for(const field of definition.fields){
    const label=document.createElement('label');label.textContent=field.label;
    const input=document.createElement('input');input.type=field.type||'number';input.dataset.effectParam=field.key;
    input.value=String(effect.parameters[field.key]??definition.defaults[field.key]);
    if(field.min!==undefined)input.min=String(field.min);if(field.max!==undefined)input.max=String(field.max);if(field.step!==undefined)input.step=String(field.step);
    label.append(input);card.append(label);
   }
   const actions=document.createElement('div');actions.className='manual-effect-actions';
   if(definition)actions.append(manualButton('Apply','apply',effect.id));
   actions.append(manualButton(effect.enabled?'Bypass':'Enable','toggle',effect.id));
   if(index>0)actions.append(manualButton('Move up','up',effect.id));
   if(index<item.effects.length-1)actions.append(manualButton('Move down','down',effect.id));
   actions.append(manualButton('Remove','remove',effect.id));card.append(actions);list.append(card);
  }
 }
 if(item.type==='title'){
  $('manual-title-text').value=item.text;
  $('manual-title-size').value=String(item.style.fontSize??96);
  $('manual-title-weight').value=String(item.style.fontWeight??700);
  $('manual-title-color').value=/^#[0-9a-f]{6}$/i.test(item.style.foregroundColor)?item.style.foregroundColor:'#ffffff';
  $('manual-title-background').value=/^#[0-9a-f]{6}$/i.test(item.style.backgroundColor)?item.style.backgroundColor:'#000000';
  $('manual-title-background-enabled').checked=!!item.style.backgroundColor&&!['0x00000000','#00000000'].includes(item.style.backgroundColor);
  $('manual-title-placement').value=item.style.placement||'center';
 }
 if(!$('manual-animation').hidden){
  const property=$('manual-keyframe-property').value;
  $('manual-keyframe-value').value=String(item.transform?.[property.slice(10)]??(property==='transform.opacity'||property.startsWith('transform.scale')?1:0));
  const list=$('manual-keyframe-list');list.replaceChildren();
  for(const curve of item.automationCurves||[]){if(!manualKeyframeProperties.has(curve.parameter))continue;
   const heading=document.createElement('p');heading.className='manual-keyframe-heading';heading.textContent=curve.parameter.slice(10);list.append(heading);
   for(const keyframe of curve.keyframes){const row=document.createElement('div');row.className='manual-keyframe-row';
    const text=document.createElement('span');text.textContent=seconds(keyframe.time).toFixed(2)+'s · '+keyframe.value;
    const remove=manualButton('Remove','keyframe-remove',keyframe.id);remove.dataset.curveId=curve.id;row.append(text,remove);list.append(row);
   }
  }
 }
}
function manualEffectTarget(){const chosen=selection();if(!chosen||chosen.item.type!=='clip'||chosen.track.kind!=='video')throw Error('Select an editable video layer.');if(chosen.track.locked||chosen.item.locked)throw Error('Unlock the layer and track first.');return chosen;}
bind('manual-effect-add',async()=>{const {track,item}=manualEffectTarget(),id=$('manual-effect-type').value,definition=manualEffectDefinitions[id];if(!definition||!state.capabilities.some(c=>c.id===id&&c.available))throw Error('Choose an available native effect.');await commit([operation('effect.add',{sequenceId:seq().id,trackId:track.id,effect:{id:uid(),capabilityId:id,version:'1.0.0',enabled:true,parameters:{...definition.defaults},automationCurves:[]}},item.id)]);});
$('manual-effect-list').addEventListener('click',guard(async event=>{const button=event.target.closest('[data-manual-action]');if(!button)return;const {track,item}=manualEffectTarget(),effect=item.effects.find(e=>e.id===button.dataset.effectId);if(!effect)throw Error('That effect changed. Select the layer again.');const args={sequenceId:seq().id,trackId:track.id,effectId:effect.id};
 if(button.dataset.manualAction==='remove')return commit([operation('effect.remove',args,item.id)]);
 if(button.dataset.manualAction==='toggle')return commit([operation(effect.enabled?'effect.disable':'effect.enable',args,item.id)]);
 if(button.dataset.manualAction==='up'||button.dataset.manualAction==='down'){const current=item.effects.findIndex(e=>e.id===effect.id),index=current+(button.dataset.manualAction==='up'?-1:1);return commit([operation('effect.reorder',{...args,index},item.id)]);}
 if(button.dataset.manualAction==='apply'){const definition=manualEffectDefinitions[effect.capabilityId],card=button.closest('.manual-effect-card');if(!definition)return;const operations=[];for(const field of definition.fields){const input=card.querySelector('[data-effect-param="'+field.key+'"]');let value=input.value;if(field.type==='color'){if(!/^#[0-9a-f]{6}$/i.test(value))throw Error('Choose a valid key color.');}else{value=Number(value);if(!Number.isFinite(value)||value<field.min||value>field.max)throw Error(field.label+' is outside its allowed range.');}if(value!==effect.parameters[field.key])operations.push(operation('effect.parameter.set',{...args,parameter:field.key,value},item.id));}if(operations.length)await commit(operations);}
}));
bind('manual-title-save',async()=>{const chosen=selection();if(!chosen||chosen.item.type!=='title'||chosen.track.locked||chosen.item.locked)throw Error('Select an editable title.');const text=$('manual-title-text').value,size=Number($('manual-title-size').value),weight=Number($('manual-title-weight').value);if(!text.trim()||!Number.isInteger(size)||size<8||size>512||!Number.isInteger(weight)||weight<100||weight>1000)throw Error('Enter title text, size 8–512 and weight 100–1000.');const style={...chosen.item.style,fontSize:size,fontWeight:weight,foregroundColor:$('manual-title-color').value,backgroundColor:$('manual-title-background-enabled').checked?$('manual-title-background').value:'0x00000000',placement:$('manual-title-placement').value};const title={...chosen.item,text,name:text.trim().slice(0,60),style};await commit([operation('title.update',{sequenceId:seq().id,trackId:chosen.track.id,title},chosen.item.id)]);});
bind('manual-keyframe-add',async()=>{const chosen=selection(),item=chosen?.item,parameter=$('manual-keyframe-property').value,value=Number($('manual-keyframe-value').value);if(!chosen||!item||!['clip','title'].includes(item.type)||chosen.track.locked||item.locked)throw Error('Select an editable video layer or title.');if(!manualKeyframeProperties.has(parameter)||!Number.isFinite(value))throw Error('Choose a property and a finite value.');if(parameter==='transform.opacity'&&(value<0||value>1))throw Error('Opacity must be between 0 and 1.');if(parameter.startsWith('transform.scale')&&(value<0.01||value>100))throw Error('Scale must be between 0.01 and 100.');const local=snap(state.playhead-seconds(item.timelineRange.start));if(local<0||local>=seconds(item.timelineRange.duration))throw Error('Move the playhead inside the selected layer.');const curves=structuredClone(item.automationCurves||[]);let curve=curves.find(c=>c.parameter===parameter);if(!curve){curve={id:uid(),parameter,keyframes:[]};curves.push(curve);}const frame=time(local),existing=curve.keyframes.find(k=>k.time.value===frame.value&&k.time.rate.numerator===frame.rate.numerator&&k.time.rate.denominator===frame.rate.denominator);if(existing)existing.value=value;else curve.keyframes.push({id:uid(),time:frame,value,interpolation:'linear'});curve.keyframes.sort((a,b)=>seconds(a.time)-seconds(b.time));await commit([operation('item.automation.set',{sequenceId:seq().id,trackId:chosen.track.id,automationCurves:curves},item.id)]);});
$('manual-keyframe-list').addEventListener('click',guard(async event=>{const button=event.target.closest('[data-manual-action="keyframe-remove"]');if(!button)return;const chosen=selection(),item=chosen?.item;if(!chosen||!item||!['clip','title'].includes(item.type)||chosen.track.locked||item.locked)throw Error('Select an editable layer.');const curves=structuredClone(item.automationCurves||[]);const curve=curves.find(c=>c.id===button.dataset.curveId);if(!curve)throw Error('That keyframe changed. Select the layer again.');curve.keyframes=curve.keyframes.filter(k=>k.id!==button.dataset.effectId);const remaining=curves.filter(c=>c.keyframes.length);await commit([operation('item.automation.set',{sequenceId:seq().id,trackId:chosen.track.id,automationCurves:remaining},item.id)]); }));
$('manual-keyframe-property').addEventListener('change',()=>{const item=selection()?.item,property=$('manual-keyframe-property').value;$('manual-keyframe-value').value=String(item?.transform?.[property.slice(10)]??(property==='transform.opacity'||property.startsWith('transform.scale')?1:0));});
`;

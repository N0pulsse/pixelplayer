window.Spotify={Player:class{
 constructor(options){window.__sdkFixture=this;this.options=options;this.listeners={};this.state={paused:false,position:10000,duration:120000,repeat_mode:0,shuffle:false,disallows:{},track_window:{current_track:{id:'a'.repeat(22),uri:'spotify:track:'+'a'.repeat(22),name:'SDK audio fixture',artists:[{name:'QA Artist'}],album:{name:'QA Album',images:[]}}}};}
 addListener(name,fn){this.listeners[name]=fn;}
 async connect(){await new Promise(resolve=>this.options.getOAuthToken(value=>{if(value!=='synthetic-token')throw new Error('Invalid fixture token');resolve();}));this.listeners.ready({device_id:'sdk-qa'});this.listeners.player_state_changed(this.state);return true;}
 async getCurrentState(){return this.state;}
 async pause(){this.state.paused=true;this.listeners.player_state_changed(this.state);}
 async resume(){this.state.paused=false;this.listeners.player_state_changed(this.state);}
 async seek(value){this.state.position=value;this.listeners.player_state_changed(this.state);}
 async setVolume(){} async activateElement(){} async disconnect(){}
}};
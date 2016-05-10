const exec=require('child_process').exec;
const fs=require('fs');
const respawn = require('respawn');

var geomux = function geomux(name, deps) {
  console.log('The geo-mux plugin.');

  //state variables
  this.deps = deps;
  var self=this;
  this.services={};

}

geomux.prototype.enumerateDevices = function enumerateDevices(callback){
  var results=[];
  var i=0;
  fs.readdir('/dev', function (err, files) {
    if (err) {
      reject(err);
    }
    files.filter(function(file){
        return file.indexOf('video') == 0;
    }).forEach(function(file){
      //udevadm info --query=all --name=/dev/' + file
      //
      i++;
      exec('udevadm info --query=all --name=/dev/' + file + ' | grep "S: v4l/by-id/"', function(error, stdout, stderr){
        if ((error == null) && (stdout.indexOf('GEO_Semi_Condor')>0)){
          var result = {device: file, format:'MP4'}
          result.deviceid = stdout.slice("S: v4l/by-id/".length);
          results.push(result);
        }
        i--;
        if(i==0){callback(results)};
      });
    });
  });
}
geomux.prototype.start = function start(){
  var self=this;
  if (process.env.GEO_MOCK == 'true'){
    this.startCamera('/dev/video0');
  } else {
    this.enumerateDevices(function(results){
      if (results.length==0) return;
      self.deps.globalEventLoop.emit('video-deviceRegistration',results);
      sortedResult=results.sort(function(a,b){return a.device.localeCompare(b.device)});
      self.startCamera('/dev/' + sortedResult[0].device); //start first camera
    })
  }
}

geomux.prototype.startCamera = function startCamera(device){
  var geoprogram = '';
  if (process.env.GEO_MOCK == 'true'){
    geoprogram = require.resolve('geo-video-simulator');
  }
  else {
    try {
      geoprogram =require.resolve('geo-video-server')
    } catch (er) {
      console.log(process.env.GEO_MOCK);
      console.log("geo-video-server not installed")
      return;
    }
  }

  var launch_options = ['nice','-1','node',geoprogram];
  //TODO: Add device to the parameters once it is supported in geomux

  const infinite=-1;
  var monitor = respawn(launch_options,{
      name: 'geomux',
      maxRestarts: infinite,
      sleep: 1000
  })

  var self = this;

  monitor.on('stderr',function(data)
  {
    var msg = data.toString('utf-8');
    
    var status;
    
    try 
    {
      status = JSON.parse(msg);
      
      if( status.type === undefined )
      {
        throw "Invalid message structure";
      }
    } 
    catch (e) 
    {
      return; //abort, not a json message
    }
    
    console.log( JSON.stringify( msg ) );
    
    if( status.type === "CameraAnnouncement" )
    {
      self.deps.globalEventLoop.emit('CameraRegistration',
      { 
        location:           status.payload.txtRecord.cameraLocation,
        videoMimeType:      status.payload.txtRecord.videoMimeType,
        resolution:         status.payload.txtRecord.resolution,
        framerate:          status.payload.txtRecord.framerate,
        relativeServiceUrl: status.payload.txtRecord.relativeServiceUrl,
        sourcePort:         status.payload.port,
        sourceAddress:      status.payload.addresses[0]
      });  
    }
    else if( status.type === "ChannelHealth" )
    {
      self.deps.globalEventLoop.emit('ChannelHealth',
      { 
        channel:        status.payload.chNum,
        fps:            status.payload.stats.fps,
        droppedFrames:  status.payload.stats.droppedFrames,
        latency_us:     status.payload.stats.latency_us
      });  
    }

  });

  monitor.start();

};

//Export provides the public interface
module.exports = function (name, deps) {
  return new geomux(name,deps);
};

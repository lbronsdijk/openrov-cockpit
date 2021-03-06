const exec=require('child_process').exec;
const fs=require('fs');
const path=require('path');
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
      callback(results);
    }
    var f = files.filter(function(file){
        return file.indexOf('video') == 0;
    });
    if (f.length==0){
      callback(result);
      return;
    }
    f.forEach(function(file){
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

geomux.prototype.startDevices = function startDevices(callback){
    exec('mxcam list | grep "Core: Condor"', function(error, stdout, stderr){
      if (error == null){
        exec(path.dirname(require.resolve('geo-video-server'))+'/platform/linux/bootcamera.sh', function(error, stdout, stderr){
          setTimeout(function(){
            callback();
          },1000);  //give the system a moment to stabalize after the bootcamera script
        });
      } else {
        console.error('Error staring devices geo: ',JSON.stringify(error));
        callback();
      }
    });


}
var timeoutscale = .1;
geomux.prototype.start = function start(){
  console.log('geo:start');
  var self=this;
  if (process.env.GEO_MOCK == 'true'){
    this.startCamera('/dev/video0');
  } else {
    this.startDevices(function(){
      self.enumerateDevices(function(results){
        if (results.length==0){
          setTimeout(self.start.bind(this),1000*120*timeoutscale);
          if (timeoutscale<1){
            timoutscale+=.1;
          }
          return;
        }
        self.deps.globalEventLoop.emit('video-deviceRegistration',results);
        sortedResult=results.sort(function(a,b){return a.device.localeCompare(b.device)});
        self.startCamera('/dev/' + sortedResult[0].device); //start first camera
      })
    });
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

  var launch_options = ['nice','-1','node',geoprogram,'--wspath=/geovideo1','--port=8099'];
  //TODO: Add device to the parameters once it is supported in geomux

  const infinite=-1;
  var monitor = respawn(launch_options,{
      name: 'geomux',
      maxRestarts: infinite,
      sleep: 1000
  })

  var self = this;

  monitor.on('stdout',function(data){
//      var msg = data.toString('utf-8');
//      console.log(msg);
  });

  monitor.on('stderr',function(data){
    var msg = data.toString('utf-8');
    var service;
    try {
      service = JSON.parse(msg);
    } catch (e) {
      return; //abort, not a json message
    }
    if ('service' in service){
      self.deps.globalEventLoop.emit('CameraRegistration',{location:service.txtRecord.cameraLocation, videoMimeType:service.txtRecord.videoMimeType, resolution:service.txtRecord.resolution, framerate:service.txtRecord.framerate, relativeServiceUrl:process.env.GEO_MOCK=='true'?':8099':'', wspath:'/geovideo1', connectionType:'socket.io', sourcePort:service.port, sourceAddress:service.addresses[0]});
      console.log('sending CameraRegistration');
    }

  });

  monitor.start();

};

//Export provides the public interface
module.exports = function (name, deps) {
  return new geomux(name,deps);
};

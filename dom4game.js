
/********************************************************************
*                       CONSIDERATIONS:                             *
* Must not use several socket commands that make the slave server   *
* rehost the game instance, because it will result in several       *
* instances being launched. Therefore, those commands that          *
* require more than one game instance reboot (i.e. first rollback,  *
* then adjusting the current timer) will have the subsequent        *
* reboots handled in the slave server                               *
********************************************************************/

const fs = require('fs');
const translator = require("./translator.js");
const timerModule = require("./timer.js");
const rw = require("./reader_writer.js");
const config = require("./config.json");
const newsModule = require("./news_posting.js");
const defaultTimer = require("./settings/dom4/default_timer.js");
const currentTimer = require("./settings/dom5/current_timer.js");
var playerPreferences;

if (require("./command_modules/game_preferences.js") == null)
{
  rw.log("general", `game_preferences.js not found. Reminders are disabled.`);
}

else playerPreferences = require("./command_modules/game_preferences.js");

function createPrototype()
{
  var prototype = {};

  prototype.gameType = config.dom4GameTypeName;
  prototype.port = null;
  prototype.server = null;
  prototype.serverToken = null;
  prototype.name = "Prototype";
  prototype.tracked = true;
  prototype.guild = null;
  prototype.organizer = null;
  prototype.reminders = {};
  prototype.runtime = 0;
  prototype.lastHosted = 0;
  prototype.firstHosted = Date.now();
  prototype.wasStarted = false;
  prototype.timerChanged = false;
  prototype.channel = null;
  prototype.role = null;
  prototype.isOnline = false;
  prototype.isServerOnline = true;
  prototype.startedAt = null;


  /****************
  *   FUNCTIONS   *
  ****************/
  prototype.toJSON = toJSON;
  prototype.toSlaveServerData = toSlaveServerData;
  prototype.setOnlineServer = setOnlineServer;
  prototype.setServerOffline = setServerOffline;
  prototype.printSettings = printSettings;
  prototype.settingsToExeArguments = settingsToExeArguments;
  prototype.start = start;
  prototype.restart = restart;
  prototype.host = host;
  prototype.track = track;
  prototype.untrack = untrack;
  prototype.kill = kill;
  prototype.rehost = rehost;
  prototype.changeCurrentTimer = changeCurrentTimer;
  prototype.changeDefaultTimer = changeDefaultTimer;
  prototype.updateLastHostedTime = updateLastHostedTime;
  prototype.sendStales = sendStales;
  prototype.statusCheck = statusCheck;
  prototype.updateTurnInfo = updateTurnInfo;
  prototype.processNewTurn = processNewTurn;
  prototype.processNewHour = processNewHour;
  prototype.announceTurn = announceTurn;
  prototype.announceLastHour = announceLastHour;
  prototype.deleteGameData = deleteGameData;
  prototype.deleteGameSavefiles = deleteGameSavefiles;
  prototype.backupSavefiles = backupSavefiles;
  prototype.rollback = rollback;
  prototype.getTurnInfo = getTurnInfo;
  prototype.getCurrentTimer = getCurrentTimer;
  prototype.getLocalCurrentTimer = getLocalCurrentTimer;
  prototype.getLocalDefaultTimer = getLocalDefaultTimer;
  prototype.save = save;

  return prototype;
}

module.exports.create = function(name, port, member, server, isBlitz, settings = {}, cb)
{
  var game = createPrototype();

  game.name = name;
  game.ip = server.ip;
  game.port = port;
  game.gameType = config.dom4GameTypeName;
  game.isBlitz = isBlitz;
  game.settings = settings;

  //currentTimer is not part of the default settings package, therefore
  //add it manually and set it to the default timer
  game.settings[currentTimer.getKey()] = settings[defaultTimer.getKey()];
  game.server = server;
  game.serverToken = server.token;
  game.organizer = member;
  game.guild = member.guild;

  game.server.socket.emit("create", game.toSlaveServerData(), function(err)
  {
    if (err)
    {
      rw.log("error", true, `"create" slave Error:`, {Game: game.name}, err);
      cb(err, null);
      return;
    }

    cb(null, game);
  });
};

module.exports.fromJSON = function(json, guild, cb)
{
  var game = Object.assign(createPrototype(), json);

  game.settings[defaultTimer.getKey()] = defaultTimer.revive(game.settings[defaultTimer.getKey()]);
  game.settings[currentTimer.getKey()] = currentTimer.revive(game.settings[currentTimer.getKey()]);
  game.guild = guild;

  //Reset the isOnline and isServerOnline properties and the object is just being revived right now
  game.isOnline = false;
  game.isServerOnline = false;

  if (game.organizer != null)
  {
    game.organizer = game.guild.members.get(game.organizer);
  }

  if (game.channel != null)
  {
    game.channel = game.guild.channels.get(game.channel);
  }

  if (game.role != null)
  {
    game.role = game.guild.roles.get(game.role);
  }

  cb(null, game);
};

/************************************************************
*                       toJSON()                            *
* is called whenever JSON.stringify() is used on the object *
************************************************************/

function toJSON()
{
  var jsonObj = Object.assign({}, this);

  jsonObj.server = null;
  jsonObj.instance = null;
  jsonObj.guild = this.guild.id;
  jsonObj.organizer = this.organizer.id;

  if (jsonObj.channel != null)
  {
    jsonObj.channel = this.channel.id;
  }

  if (jsonObj.role != null)
  {
    jsonObj.role = this.role.id;
  }

  return jsonObj;
}

function toSlaveServerData()
{
  return {
    name: this.name,
    port: this.port,
    gameType: this.gameType,
    args: this.settingsToExeArguments()
  }
}

/************************************************
*            EXTERNAL FUNCTIONS                 *
* These make socket calls to the slave servers  *
************************************************/

function start(cb)
{
  var that = this;
  var data = this.toSlaveServerData();
  data.args.concat(["--uploadtime", 1]);

  //sends the regular exe arguments plus an upload time limit to start it
  this.server.socket.emit("start", data, function(err)
  {
    if (err)
    {
      rw.log("error", true, `"start" slave Error:`, {Game: that.name}, err);
      cb(err);
      return;
    }

    that.settings[currentTimer.getKey()] = Object.assign({}, that.settings[defaultTimer.getKey()]);
    cb();
  });
}

function restart(cb)
{
  var that = this;

  this.server.socket.emit("restart", this.toSlaveServerData(), function(err)
  {
    if (err)
    {
      rw.log("error", true, `"restart" slave Error:`, {Game: that.name}, err);
      cb(err);
      return;
    }

    that.wasStarted = false;
    that.startedAt = 0;
    that.settings[currentTimer.getKey()] = that.settings[defaultTimer.getKey()];
    cb();
  });
}

function host(options, cb)
{
  //preserve context to use in callback below
  var that = this;
  var args = this.settingsToExeArguments(options);

  //no options were passed
  if (typeof options === "function" && cb == null)
  {
    cb = options;
  }

  if (this.server == null)
  {
    cb(`${this.name} has no server assigned; cannot host it.`, null);
    return;
  }

  if (this.isServerOnline === false)
  {
    cb(`${this.name}'s server is offline; cannot host it.`, null);
    return;
  }

  if (options != null && options.extraArgs != null && Array.isArray(extraArgs) === true)
  {
    args = args.concat(extraArgs);
  }

  //send request to slave server to host the process
  this.server.socket.emit("host", this.toSlaveServerData(), function(err, warning)
  {
    if (err)
    {
      rw.log("error", true, `"host" slave Error:`, {Game: that.name}, err);
      cb(err, null);
      return;
    }

    else if (warning)
    {
      rw.log("general", warning);
    }

    that.isOnline = true;
    cb(null);
  });
}

function kill(cb)
{
  //preserve context to use in callback below
  var that = this;

  //Kill and relaunch the dom5 instance with the full default timer
  this.server.socket.emit("kill", this.toSlaveServerData(), function(err)
  {
    if (err)
    {
      rw.log("error", true, `"kill" slave Error:`, {Game: that.name}, err);
      cb(err, null);
      return;
    }

    that.isOnline = false;
    cb(null);
  });
}

function rehost(options, cb)
{
  let that = this;

  this.kill(function(err)
  {
    if (err)
    {
      cb(err);
      return;
    }

    that.host(options, cb);
  });
}

function changeCurrentTimer(timer, cb)
{
  var that = this;
  var data = Object.assign({}, this.toSlaveServerData(), {timer: timer.toExeArguments()});

  this.server.socket.emit("changeCurrentTimer", data, function(err)
  {
    if (err)
    {
      rw.log("error", true, `"changeCurrentTimer" slave Error:`, {Game: that.name}, err);
      that.organizer.send(`An error occurred; failed to change the current timer to ${timer.shortPrint()}.`);
      cb(err, null);
      return;
    }

    //can't do Object.assign or it will also change the turn number
    that.settings[currentTimer.getKey()].days = timer.days;
    that.settings[currentTimer.getKey()].hours = timer.hours;
    that.settings[currentTimer.getKey()].minutes = timer.minutes;
    that.settings[currentTimer.getKey()].seconds = timer.seconds;
    that.settings[currentTimer.getKey()].isPaused = timer.isPaused;
    that.timerChanged = true;
    cb(null);
  });
}

//In dom4, the turn timer must be changed after every new turn to be reset to
//the default one, therefore each new turn the changeCurrentTimer function
//will be sent to the slave server with the default timer as the argument
function changeDefaultTimer(timer, cb)
{
  this.settings[defaultTimer.getKey()] = Object.assign(timer);
  cb(null);
}

function sendStales(cb)
{
  var that = this;
  var msg = "The following nations staled this turn in " + this.name + ":\n";
  var data = Object.assign({}, this.toSlaveServerData(), {lastHostedTime: this.lastHosted});

  /*The staleArray received is an array of Strings, each of them being the filename of a nation that staled this turn.*/
  this.server.socket.emit("getStales", data, function(err, staleArray)
  {
    if (err)
    {
      rw.log("error", true, `"getStales" slave Error:`, {Game: that.name}, err);
      that.organizer.send(`An error occurred; could not fetch the information on stales for the game ${that.name}.`);
      cb(err);
      return;
    }

    //translate the filenames to nation names. When a nation filename is not in the nations' pool
    //(i.e. it's a NationGen game or a modded nation), the filename will be kept
    staleArray.forEach(function(nation, index)
    {
      staleArray[index] = translator.dom4NationFilenameToName(nation, that.settings.era);
    });

    if (staleArray.length > 0)
    {
      that.organizer.send(`${msg}\n\n${staleArray.join("\n").toBox()}`);
    }

    cb(null);
  });
}

function updateLastHostedTime(cb)
{
  var that = this;

  this.server.socket.emit("getLastHostedTime", this.toSlaveServerData(), function(err, time)
  {
    if (err)
    {
      rw.log("error", true, `"getLastHostedTime" slave Error:`, {Game: that.name}, err);
      cb(err, null);
      return;
    }

    that.lastHosted = time;
    cb(null, time);
  });
}

function deleteGameData(cb)
{
  var path = `${config.pathToGameData}/${this.name}`;

  //preserve context to use in callback below
  var that = this;

  //send the request for the slave server to delete its data as well
  this.server.socket.emit("deleteGameData", this.toSlaveServerData(), function(err)
  {
    if (err)
    {
      rw.log("error", true, `"deleteGameData" slave Error:`, {Game: that.name, err: err});
      cb(`An Error occurred when trying to delete ${this.server.name}'s game data:\n\n${err}`);
      return;
    }

    //delete the Discord bot's data files on the game
    if (fs.existsSync(path) === false)
  	{
      return;
    }

    rw.deleteDir(path, function(err)
    {
      if (err)
      {
        rw.log("error", true, {path: path, err: err});
        cb(`An Error occurred when trying to delete the game's bot data.`);
        return;
      }

      cb();
    });
  });
}

function deleteGameSavefiles(cb)
{
  //preserve context to use in callback below
  var that = this;

  this.server.socket.emit("deleteGameSavefiles", this.toSlaveServerData(), function(err)
  {
    if (err)
    {
      rw.log("error", true, `"deleteGameSavefiles" slave Error:`, {Game: that.name}, err);
      cb(err, null);
    }

    else cb(null);
  });
}

function backupSavefiles(isNewTurn, cb)
{
  var that = this;
  var data = Object.assign({}, this.toSlaveServerData(), {isNewTurn: isNewTurn, turnNbr: this.settings[currentTimer.getKey()].turn});

  //backup game's save files
  this.server.socket.emit("backupSavefiles", data, function(err)
  {
    if (err)
    {
      rw.log("error", true, `"backupSavefiles" slave Error:`, {Game: that.name}, err);
      cb(err);
      return;
    }

    cb(null);
  });
}

//restores the previous turn of the game
function rollback(cb)
{
  var that = this;
  var data = Object.assign({}, this.toSlaveServerData(), {turnNbr: this.settings[currentTimer.getKey()].turn - 1, timer: this.settings[defaultTimer.getKey()].toExeArguments()});

  this.server.socket.emit("rollback", data, function(err)
  {
    if (err)
    {
      rw.log("error", true, `"rollback" slave Error:`, {Game: that.name}, err);
      cb(err);
      return;
    }

    //update the latest turn
    that.settings[currentTimer.getKey()].turn--;
    cb(null);
  });
}

function getTurnInfo(cb)
{
  var that = this;

  this.server.socket.emit("getTurnInfo", this.toSlaveServerData(), function(err, info)
  {
    if (err)
    {
      rw.log("error", true, `"getTurnInfo" slave Error:`, {Game: that.name}, err);
      cb(err, null);
    }

    else cb(null, info);
  });
}

function getCurrentTimer(cb)
{
  //preserve context to use in callback below
  var that = this;

  this.getTurnInfo(function(err, cTimer)
  {
    if (err)
    {
      cb(err);
      return;
    }

    else if (that.wasStarted === false)
    {
      cb(null, "The game has not started yet!");
    }

    else if (cTimer == null || cTimer.turn === 0)
    {
      rw.log("general", `The game's status reports a blank timer. The game instance probably needs to be run before using timer commands so that it can update itself. Game might also be generating the map if it was just started.`);
      cb(null, "The game's status reports a blank timer. The game instance probably needs to be run before using timer commands so that it can update itself. Game might also be generating the map if it was just started.");
    }

    else if (cTimer.isPaused === true)
    {
      cb(null, `It is turn ${currentTimer.turn}, and the timer is paused.`);
    }

    else if (cTimer.totalSeconds > 0)
    {
      cb(null, `It is turn ${cTimer.turn}, and there are ${timerModule.print(cTimer)} left for it to roll.`);
    }

    else
    {
      cb(null, "Unless something's wrong, one minute or less remains for the turn to roll. It might even be processing right now. The new turn announcement should come soon.");
    }
  });
}

function processNewTurn(newTimerInfo, cb)
{
  //preserve context to use in callback below
  var that = this;

  //set to start it when the new turn is detected, rather than when using the
  //!start command, since generation might fail
  if (newTimerInfo.turn === 1)
  {
    this.wasStarted = true;
    that.startedAt = Date.now();
  }

  if (this.wasStarted === false)
  {
    rw.log("error", `${this.name} .wasStarted is false, but it received a newTimerInfo of:`, newTimerInfo);
  }

  that.updateLastHostedTime(function(err)
  {
    //backup game's bot data
    rw.copyDir(`${config.pathToGameData}/${that.name}`, `${config.pathToGameDataBackup}/${that.name}`, false, null, function(err)
    {
      this.changeCurrentTimer(this.settings[defaultTimer.getKey()], function(err)
      {
        if (err)
        {
          return cb(err);
        }

        else rw.log("general", `New turn's current timer changed to:`, that.settings[defaultTimer.getKey()]);

        if (that.isBlitz === true)
        {
          return cb();
        }

        that.announceTurn(newTimerInfo, function()
        {
          cb(null, true);
        });
      });
    });
  });
}

/********************************
*        LOCAL FUNCTIONS        *
* No calls to the slave servers *
********************************/
//gets the current turn that the bot is aware of,
//without fetching the most recent one from the server that is hosting the game
function getLocalCurrentTimer()
{
  if (this.settings[currentTimer.getKey()] == null)
  {
    return this.settings[defaultTimer.getKey()];
  }

  else return this.settings[currentTimer.getKey()];
}

//gets the default timer that the bot is aware of,
//without fetching the most recent one from the server that is hosting the game
function getLocalDefaultTimer()
{
  return this.settings[defaultTimer.getKey()];
}

function setOnlineServer(server)
{
  if (typeof this.server === "string" && this.server !== server.token)
  {
    throw "The server that is trying to host the game does not match the recorded one.";
  }

  //will get assigned even if this.server is null, since there's probably a reason
  //why the server that's passed has this game in the first place
  this.server = server;
  this.ip = server.ip;
  this.isServerOnline = true;
}

function setServerOffline()
{
  this.isOnline = false;
  this.isServerOnline = false;
  //this.organizer.send(`The server on which the game ${this.name} was hosted has disconnected. If it reconnects automatically or this gets resolved, the game will be back online.`);
}

function printSettings()
{
  return translator.translateGameInfo(this);
}

function settingsToExeArguments(options)
{
  let def = [this.name, "--nosound", "--window", "--tcpserver", "--port", this.port, "--noclientstart", "--renaming"];
  let settings = def.concat(translator.settingsToExeArguments(this.settings, this.gameType));

  if (options == null || (options != null && options.ui !== true))
  {
    settings.push("--textonly");
  }

  if (options != null && options.screen === true)
  {
    settings.unshift("screen", "-d");
  }

  //no current timer, so use default
  if (this.settings[currentTimer.getKey()] == null)
  {
    return settings.concat(defaultTimer.toExeArguments(this.settings[defaultTimer.getKey()]));
  }

  else
  {
    return settings.concat(currentTimer.toExeArguments(this.settings[currentTimer.getKey()]));
  }
}

function statusCheck(cb)
{
  //preserve context to use in callback below
  var that = this;

  if (this.isOnline === true)
  {
    this.runtime += 30; //seconds
  }

  if (this.isServerOnline === false || this.server == null || this.server.socket == null)
  {
    //server offline
    return;
  }

  this.getTurnInfo(function(err, info)
  {
    if (err)
    {
      rw.log("error", `Error occurred when getting turn info of game ${that.name}:`, err);
      cb(err);
      return;
    }

    //not started so don't pay attention to an empty timer
    if (that.wasStarted === false && (info == null || info.turn === 0 || info.turn == null))
    {
      cb();
      return;
    }

    if (that.wasStarted === true && (info == null || info.turn === 0 || info.turn == null))
    {
      rw.log("error", `getTurnInfo() did not return a proper timer even though the game ${that.name} was started.`);
      cb(`getTurnInfo() did not return a proper timer even though the game ${that.name} was started.`);
      return;
    }

    that.updateTurnInfo(info, function(err)
    {
      if (err)
      {
        cb(err);
        return;
      }

      that.save(cb);
    });
  });
}

function updateTurnInfo(newTimerInfo, cb)
{
  var oldCurrentTimer = Object.assign({}, this.settings[currentTimer.getKey()]);
  this.settings[currentTimer.getKey()].assignNewTimer(newTimerInfo);

  if (this.channel == null)
  {
    cb(`The channel for the game ${this.name} could not be found. Impossible to announce changes.`);
    return;
  }

  if (this.role == null)
  {
    cb(`The role for the game ${this.name} could not be found.`);
    return;
  }

  if (newTimerInfo.turn > oldCurrentTimer.turn)
  {
    this.processNewTurn(newTimerInfo, cb);
  }

  //An hour went by, so check and send necessary reminders
  else if (oldCurrentTimer.getTotalHours() === newTimerInfo.totalHours + 1 && this.isBlitz === false)
  {
    this.processNewHour(newTimerInfo);
  }

  else
  {
    cb(null);
  }
}

function processNewHour(newTimerInfo)
{
  if (playerPreferences != null)
  {
    playerPreferences.sendReminders(this, newTimerInfo.totalHours);
  }

  if (newTimerInfo.totalHours <= 0 && newTimerInfo.totalSeconds != 0)
  {
    this.announceLastHour(newTimerInfo);
  }
}

function announceTurn(newTimerInfo, cb)
{
  if (newTimerInfo.turn === 1)
  {
    rw.log("general", `${this.name}: game started! The default turn timer is: ${this.settings[defaultTimer.getKey()].print()}.`);
    this.channel.send(`${this.role} Game started! The default turn timer is: ${this.settings[defaultTimer.getKey()].print()}.`);
    newsModule.post(`The game ${this.name} (${this.channel}) started!`, this.guild.id);
    cb(null);
  }

  else
  {
    rw.log("general", `${this.name}: new turn ${newTimerInfo.turn}! ${this.settings[defaultTimer.getKey()].print()} left for the next turn.`);
    this.channel.send(`${this.role} New turn ${newTimerInfo.turn} is here! ${this.settings[defaultTimer.getKey()].print()} left for the next turn.`);
    newsModule.post(`New turn in ${this.name} (${this.channel}).`, this.guild.id);
    this.sendStales(cb);
  }
}

function announceLastHour(newTimerInfo)
{
  rw.log("general", this.name + ": 1h or less left for the next turn.");
  this.channel.send(`${this.role} There are ${newTimerInfo.totalMinutes} minutes left for the new turn.`);
}

function save(cb)
{
  var that = this;

  //if directory with game name does not exist, create it.
  if (fs.existsSync(`${config.pathToGameData}/${this.name}`) == false)
  {
    fs.mkdirSync(`${config.pathToGameData}/${this.name}`);
  }

  rw.saveJSON(`${config.pathToGameData}/${this.name}/data.json`, this, function(err)
  {
    if (err)
    {
      cb(err);
      return;
    }

    cb();
  });
}

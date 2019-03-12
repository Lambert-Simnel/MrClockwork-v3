
const fs = require('fs');
const translator = require("./translator.js");
const timerModule = require("./timer.js");
const rw = require("./reader_writer.js");
const config = require("./config.json");
const newsModule = require("./news_posting.js");
const defaultTimer = require("./settings/dom5/default_timer.js");
const currentTimer = require("./settings/dom5/current_timer.js");
var playerPreferences;

if (require("./command_modules/game_preferences.js") == null)
{
  rw.log(null, `game_preferences.js not found. Reminders and turn backups are disabled.`);
}

else playerPreferences = require("./command_modules/game_preferences.js");

function createPrototype()
{
  var prototype = {};

  prototype.gameType = config.dom5GameTypeName;
  prototype.port = null;
  prototype.server = null;
  prototype.serverToken = null;
  prototype.name = "Prototype";
  prototype.settings = {};
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
  prototype.pretendersClaimed = {};
  prototype.playersReceivingBackups = {};
  prototype.playersReceivingScoreDumps = {};


  /****************
  *   FUNCTIONS   *
  ****************/
  prototype.toJSON = toJSON;
  prototype.setOnlineServer = setOnlineServer;
  prototype.setServerOffline = setServerOffline;
  prototype.printSettings = printSettings;
  prototype.settingsToExeArguments = settingsToExeArguments;
  prototype.hasClaimedPretender = hasClaimedPretender;
  prototype.isPretenderOwner = isPretenderOwner;
  prototype.subPretender = subPretender;
  prototype.claimPretender = claimPretender;
  prototype.isPlayerReceivingBackups = isPlayerReceivingBackups;
  prototype.togglePlayerBackups = togglePlayerBackups;
  prototype.isPlayerReceivingScoreDumps = isPlayerReceivingScoreDumps;
  prototype.togglePlayerScoreDumps = togglePlayerScoreDumps;
  prototype.getNationTurnFile = getNationTurnFile;
  prototype.getScoreDump = getScoreDump;
  prototype.getLocalCurrentTimer = getLocalCurrentTimer;
  prototype.getLocalDefaultTimer = getLocalDefaultTimer;
  prototype.getPlayerFromNationName = getPlayerFromNationName;
  prototype.getPlayerFromNationFilename = getPlayerFromNationFilename;
  prototype.getNationFilenameFromPlayerID = getNationFilenameFromPlayerID;
  prototype.start = start;
  prototype.restart = restart;
  prototype.host = host;
  prototype.track = track;
  prototype.untrack = untrack;
  prototype.kill = kill;
  prototype.changeCurrentTimer = changeCurrentTimer;
  prototype.changeDefaultTimer = changeDefaultTimer;
  prototype.getSubmittedPretenders = getSubmittedPretenders;
  prototype.removePretender = removePretender;
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
  prototype.save = save;
  prototype.saveSettings = saveSettings;

  return prototype;
}

module.exports.create = function(name, port, member, server, isBlitz, settings = {}, cb)
{
  var game = createPrototype();

  game.name = name;
  game.ip = server.ip;
  game.port = port;
  game.gameType = config.dom5GameTypeName;
  game.isBlitz = isBlitz;
  game.settings = settings;

  //currentTimer is not part of the default settings package, therefore
  //add it manually and set it to the default timer
  game.settings[currentTimer.getKey()] = settings[defaultTimer.getKey()];
  game.server = server;
  game.serverToken = server.token;
  game.organizer = member;
  game.guild = member.guild;

  game.server.socket.emit("create", {name: game.name, port: game.port, gameType: game.gameType, args: game.settingsToExeArguments()}, function(err)
  {
    if (err)
    {
      rw.logError({Game: game.name}, `"create" slave Error:`, err);
      cb(err, null);
      return;
    }

    cb(null, game);
  });
};

module.exports.fromJSON = function(json, guild)
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

  return game;
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

/************************************************
*            EXTERNAL FUNCTIONS                 *
* These make socket calls to the slave servers  *
************************************************/
function getSubmittedPretenders(cb)
{
  var that = this;

  this.server.socket.emit("getSubmittedPretenders", {name: this.name, port: this.port}, function(err, list)
  {
    if (err)
    {
      rw.logError({Game: that.name}, `"getSubmittedPretenders" slave Error:`, err);
      cb(err);
      return;
    }

    list.forEachAsync(function(nation, index, next)
    {
      //if the nation has been registered in the pretenders object and contains a string, it must be a user ID
      if (typeof that.pretendersClaimed[nation.filename.toLowerCase()] === "string")
      {
        that.guild.fetchMember(that.pretendersClaimed[nation.filename.toLowerCase()])
        .then(function(member)
      	{
      		nation.player = member;
          next();
      	})
        .catch(function(err)
        {
          rw.logError({pretendersClaimed: pretendersClaimed, Game: that.name}, `fetchMember Error:`, err);
          cb(`Could not fetch all the member objects from the claimed pretenders.`);
        });
      }

      else next();

    }, function callback()
    {
      cb(null, list);
    });
  });
}

function hasClaimedPretender(memberID)
{
  for (var nationFilename in this.pretendersClaimed)
  {
    if (this.pretendersClaimed[nationFilename] === memberID && typeof memberID === "string")
    {
      return true;
    }
  }

  return false;
}

function isPretenderOwner(nationFilename, memberID)
{
  if (this.pretendersClaimed[nationFilename] === memberID && typeof memberID === "string")
  {
    return true;
  }

  else return false;
}

function claimPretender(nationFilename, member, cb)
{
  var that = this;

  if (this.hasClaimedPretender(member.id) === true)
  {
    cb(`You have already claimed a pretender; each player can only control one.`);
    return;
  }

  if (typeof this.pretendersClaimed[nationFilename] === "string")
  {
    if (member.id === this.pretendersClaimed[nationFilename])
    {
      cb(`You already registered as the pretender for this nation.`);
      return;
    }

    else
    {
      that.guild.fetchMember(that.pretendersClaimed[nationFilename])
      .then(function(member)
      {
        cb(`The pretender for this nation was already registered by ${this.guild.members.get(this.pretendersClaimed[nationFilename]).user.username}.`);
        return;
      })
      .catch(function(err)
      {
        rw.logError({pretendersClaimed: pretendersClaimed, Game: that.name}, `fetchMember Error:`, err);
        cb(`This pretender seems to be claimed, but the member object could not be fetched.`);
        return;
      });
    }
  }

  that.pretendersClaimed[nationFilename] = member.id;

  that.save(function(err)
  {
    if (err)
    {
      //undo the change since the data could not be saved
      that.pretendersClaimed[nationFilename] = null;
      cb(`The pretender could not be claimed because the game's data could not be saved.`);
      return;
    }

    cb(null);
  });
}

function subPretender(nationFilename, subMember, cb)
{
  var that = this;

  if (typeof this.pretendersClaimed[nationFilename] !== "string")
  {
    cb(`This nation either has no pretender submitted or nobody claimed it.`);
    return;
  }

  this.pretendersClaimed[nationFilename] = subMember.id;

  this.save(function(err)
  {
    if (err)
    {
      //undo the change since the data could not be saved
      that.pretendersClaimed[nationFilename] = null;
      cb(`The pretender could not be claimed because the game's data could not be saved.`);
      return;
    }

    cb(null);
  });
}

function removePretender(nationFile, member, cb)
{
  var that = this;

  this.server.socket.emit("removePretender", {name: this.name, port: this.port, nationFile: nationFile}, function(err)
  {
    if (err)
    {
      cb(err);
      return;
    }

    delete that.pretendersClaimed[nationFile.toLowerCase()];
    cb(null);
  });
}

function start(cb)
{
  var that = this;
  var claimMsg = "";
  var allPretendersClaimed = true;

  this.getSubmittedPretenders(function(err, list)
  {
    if (err)
    {
      cb(`Could not receive a list of the submitted pretenders.`);
      return;
    }

    list.forEach(function(nation)
    {
      if (nation.player == null)
      {
        allPretendersClaimed = false;
        claimMsg += `${nation.name}\n`;
      }
    });

    if (allPretendersClaimed === false)
    {
      cb(`Cannot start the game. The following pretenders have not been claimed by players:\n\n${claimMsg.toBox()}`);
      return;
    }

    that.server.socket.emit("start", {name: that.name, port: that.port, timer: 60}, function(err)
    {
      if (err)
      {
        rw.logError({Game: that.name}, `"start" slave Error:`, err);
        cb(err, null);
        return;
      }

      that.wasStarted = true;
      that.settings[currentTimer.getKey()] = Object.assign({}, that.settings[defaultTimer.getKey()]);
      cb(null);
    });
  });
}

function restart(cb)
{
  var that = this;

  this.server.socket.emit("restart", {name: this.name, port: this.port}, function(err)
  {
    if (err)
    {
      rw.logError({Game: that.name}, `"restart" slave Error:`, err);
      cb(err);
      return;
    }

    that.wasStarted = false;
    that.pretendersClaimed = {};
    that.settings[currentTimer.getKey()] = that.settings[defaultTimer.getKey()];
    cb(null);
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
  this.server.socket.emit("host", {name: this.name, port: this.port, args: args}, function(err, warning)
  {
    if (err)
    {
      rw.logError({Game: that.name}, `"host" slave Error:`, err);
      cb(err, null);
      return;
    }

    else if (warning)
    {
      rw.writeToGeneralLog(warning);
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
  this.server.socket.emit("kill", {name: this.name, port: this.port}, function(err)
  {
    if (err)
    {
      rw.logError({Game: that.name}, `"kill" slave Error:`, err);
      cb(err, null);
      return;
    }

    that.isOnline = false;
    cb(null);
  });
}

function changeCurrentTimer(timer, cb)
{
  var that = this;

  this.server.socket.emit("changeCurrentTimer", {name: this.name, port: this.port, timer: timer.getTotalSeconds()}, function(err)
  {
    if (err)
    {
      rw.logError({Game: that.name}, `"changeCurrentTimer" slave Error:`, err);
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

function changeDefaultTimer(timer, cb)
{
  var that = this;

  this.server.socket.emit("changeDefaultTimer", {name: this.name, port: this.port, timer: timer.getTotalMinutes(), currentTimer: this.settings[currentTimer.getKey()].getTotalSeconds()}, function(err)
  {
    if (err)
    {
      rw.logError({Game: that.name}, `"changeDefaultTimer" slave Error:`, err);
      cb(err, null);
      return;
    }

    that.settings[defaultTimer.getKey()] = Object.assign(timer);
    cb(null);
  });
}

function sendStales(cb)
{
  var that = this;
  var staleMsg = "**" + this.name + ": the nations below staled this turn.**\n";
  var aiMsg = "**The nations below went AI this last turn:**\n";

  this.server.socket.emit("getStales", {name: this.name, port: this.port, lastHostedTime: this.lastHosted}, function(err, data)
  {
    if (err)
    {
      rw.logError({Game: that.name}, `"getStales" slave Error:`, err);
      that.organizer.send(`An error occurred; could not fetch the information on stales for the game ${that.name}.`);
      cb(err);
      return;
    }

    if (data.stales.length > 0)
    {
      that.organizer.send(`${staleMsg}\n\n${data.stales.join("\n").toBox()}`);
    }

    if (data.ai.length > 0)
    {
      that.organizer.send(`${aiMsg}\n\n${data.ai.join("\n").toBox()}`);
    }

    cb(null);
  });
}

function updateLastHostedTime(cb)
{
  var that = this;

  this.server.socket.emit("getLastHostedTime", {name: this.name, port: this.port}, function(err, time)
  {
    if (err)
    {
      rw.logError({Game: that.name}, `"getLastHostedTime" slave Error:`, err);
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
  this.server.socket.emit("deleteGameData", {name: this.name, port: this.port}, function(err)
  {
    if (err)
    {
      rw.logError({Game: that.name}, `"deleteGameData" slave Error:`, err);
      cb(err, null);
      return;
    }

    //delete the Discord bot's data files on the game
    if (fs.existsSync(path) === false)
  	{
      return;
    }

    fs.readdir(path, function(readdirErr, files)
    {
      if (readdirErr)
      {
        rw.logError({path: path}, `fs.readdir Error:`, readdirErr);
        cb(readdirErr);
        return;
      }

      files.forEachAsync(function(file, index, next)
      {
        fs.unlink(`${path}/${file}`, function(unlinkErr)
        {
          if (unlinkErr)
          {
            rw.logError({path: path, file: file}, `fs.unlink Error:`, unlinkErr);
            cb(unlinkErr);
            return;
          }

          next();
        });
      }, function callback()
      {
        fs.rmdir(path, function(rmdirErr)
        {
          if (rmdirErr)
          {
            rw.logError({path: path}, `fs.rmdir Error:`, rmdirErr);
            cb(rmdirErr);
          }

          else cb(null);
        });
      });
    });
  });
}

function deleteGameSavefiles(cb)
{
  //preserve context to use in callback below
  var that = this;

  this.server.socket.emit("deleteGameSavefiles", {name: this.name, port: this.port}, function(err)
  {
    if (err)
    {
      rw.logError({Game: that.name}, `"deleteGameSavefiles" slave Error:`, err);
      cb(err, null);
    }

    else cb(null);
  });
}

function backupSavefiles(isNewTurn, cb)
{
  var that = this;

  //backup game's save files
  this.server.socket.emit("backupSavefiles", {name: this.name, port: this.port, isNewTurn: isNewTurn, turnNbr: this.settings[currentTimer.getKey()].turn}, function(err)
  {
    if (err)
    {
      rw.logError({Game: that.name}, `"backupSavefiles" slave Error:`, err);
      cb(err);
    }

    else cb(null);
  });
}

//restores the previous turn of the game
function rollback(cb)
{
  var that = this;

  this.server.socket.emit("rollback", {name: this.name, port: this.port, turnNbr: this.settings[currentTimer.getKey()].turn - 1}, function(err)
  {
    if (err)
    {
      rw.logError({Game: that.name}, `"rollback" slave Error:`, err);
      cb(err);
      return;
    }

    //update the latest turn
    that.settings[currentTimer.getKey()].turn--;
    that.changeCurrentTimer(that.settings[defaultTimer.getKey()], function(err)
    {
      if (err)
      {
        cb(`Rollback successful, but could not change the current timer to match the default timer.`);
        return;
      }

      cb(null);
    });
  });
}

function getTurnInfo(cb)
{
  var that = this;

  this.server.socket.emit("getTurnInfo", {name: this.name, port: this.port}, function(err, info)
  {
    if (err)
    {
      rw.logError({Game: that.name}, `"getTurnInfo" slave Error:`, err);
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
      cb(err, null);
    }

    if (cTimer.turn === 0 || that.wasStarted === false)
    {
      cb(null, "The game has not started yet!");
    }

    else if (cTimer.isPaused === true)
    {
      cb(null, `It is turn ${cTimer.turn}, and the timer is paused.`);
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

//Returns "true" in the callback to indicate that a new turn happened
//This function does not return any errors to the callback, nor does it stop
//execution early, as every step of the process must be executed regardless
//of the result of the previous steps
function processNewTurn(newTimerInfo, cb)
{
  //preserve context to use in callback below
  var that = this;
  this.announceTurn(newTimerInfo);

  //send stale turns information to organizer (err handled within the function itself)
  this.sendStales(function(err)
  {
    that.settings[currentTimer.getKey()].turn = newTimerInfo.turn;

    //update timer to default turn timer (err handled within the function itself)
    that.changeCurrentTimer(that.settings[defaultTimer.getKey()], function(err)
    {
      //update the timestamp of the last time the turn was hosted (used for stales) (err handled within the function itself)
      that.updateLastHostedTime(function(err, time)
      {
        //backup game's bot data
        rw.copyDir(`${config.pathToGameData}/${that.name}`, `${config.pathToGameDataBackup}/${that.name}`, false, null, function(err)
        {
          //backup game's save files (err handled within the function itself)
          /*that.backupSavefiles(true, function(err)
          {*/
            //send turn backups to those that requested them
            if (playerPreferences != null)
            {
              playerPreferences.sendAllPlayerTurnBackups(that, function(err)
              {
                playerPreferences.sendScoreDumpsToPlayers(that, function(err)
                {
                  cb(true);
                });
              });
            }
          /*});*/
        });
      });
    });
  });
}

function processNewHour(newTimerInfo, cb)
{
  var that = this;

  if (newTimerInfo.totalHours <= 0 && newTimerInfo.totalSeconds != 0)
  {
    this.announceLastHour(newTimerInfo, function(err)
    {
      if (err)
      {
        cb(err);
      }
    });
  }

  this.server.socket.emit("getDump", {name: this.name, port: this.port}, function(err, dump)
  {
    if (err)
    {
      rw.logError({Game: that.name}, `"getDump" slave Error:`, err);
      cb(err, null);
      return;
    }

    if (playerPreferences != null)
    {
      playerPreferences.sendReminders(that, newTimerInfo.totalHours, dump);
    }
  });
}

function getNationTurnFile(nationFilename, cb)
{
  this.server.socket.emit("getTurnFile", {name: this.name.toLowerCase(), port: this.port, nationFilename: nationFilename}, function(err, buffer)
  {
    if (err)
    {
      cb(err);
    }

    else cb(null, buffer);
  });
}

function getScoreDump(cb)
{
  this.server.socket.emit("getScoreDump", {name: this.name.toLowerCase(), port: this.port}, function(err, buffer)
  {
    if (err)
    {
      cb(err);
    }

    else cb(null, buffer);
  });
}

/********************************
*        LOCAL FUNCTIONS        *
* No calls to the slave servers *
********************************/

//gets the current timer that the bot is aware of,
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

function isPlayerReceivingBackups(id)
{
  if (this.playersReceivingBackups[id] === true)
  {
    return true;
  }

  else return false;
}

function togglePlayerBackups(id)
{
  if (this.playersReceivingBackups[id] !== true)
  {
    this.playersReceivingBackups[id] = true;
  }

  else delete this.playersReceivingBackups[id];
}

function isPlayerReceivingScoreDumps(id)
{
  if (this.playersReceivingScoreDumps[id] === true)
  {
    return true;
  }

  else return false;
}

function togglePlayerScoreDumps(id)
{
  if (this.playersReceivingScoreDumps[id] !== true)
  {
    this.playersReceivingScoreDumps[id] = true;
  }

  else delete this.playersReceivingScoreDumps[id];
}

function getPlayerFromNationName(nationName)
{
  return this.pretendersClaimed[translator.dom5NationNameToFilename(nationName, this.settings.era)];
}

function getPlayerFromNationFilename(nationFilename)
{
  return this.pretendersClaimed[nationFilename];
}

function getNationFilenameFromPlayerID(id)
{
  for (var filename in this.pretendersClaimed)
  {
    if (this.pretendersClaimed[filename] === id)
    {
      return filename;
    }
  }

  return null;
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
  let def = [this.name, "--scoredump", "--nosound", "--window", "--tcpserver", "--port", this.port, "--noclientstart", "--renaming", "--statusdump"];
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

function track()
{
  this.tracked = true;
}

function untrack()
{
  this.tracked = false;
}

function statusCheck(cb)
{
  //preserve context to use in callback below
  var that = this;

  if (this.isOnline === true)
  {
    this.runtime += 60; //1 minute in seconds
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
      cb(err, null);
      return;
    }

    if (info === "")
    {
      //nothing happened
    }

    that.updateTurnInfo(info, function(err)
    {
      if (err)
      {
        cb(err);
        return;
      }

      else that.save(cb);
    });
  });
}

function updateTurnInfo(newTimerInfo, cb)
{
  var oldCurrentTimer = Object.assign({}, this.settings[currentTimer.getKey()]);
  this.settings[currentTimer.getKey()].assignNewTimer(newTimerInfo);

  if (this.tracked === false)
  {
    cb(null);
    return;
  }

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

  if (newTimerInfo.turn === 0 || this.wasStarted === false)
  {
    cb(null);
    return;
  }

  if (this.timerChanged === true)
  {
    //timer was changed right before this check, so return,
    //otherwise the bot is likely to make an announcement or
    //send reminders that don't match, since the statuspage
    //file is not yet updated
    this.timerChanged = false;
    cb(null);
  }

  //new turn
  else if (newTimerInfo.turn !== oldCurrentTimer.turn)
  {
    this.processNewTurn(newTimerInfo, cb);
  }

  //An hour went by, so check and send necessary reminders
  else if (oldCurrentTimer.getTotalHours() === newTimerInfo.totalHours + 1)
  {
    this.processNewHour(newTimerInfo, cb);
  }

  //Nothing happened, update the timer and callback
  else
  {
    cb(null);
  }
}

function announceTurn(newTimerInfo)
{
  if (newTimerInfo.turn === 1)
  {
    rw.log(null, `${this.name}: game started! The default turn timer is: ${this.settings[defaultTimer.getKey()].print()}.`);
    this.channel.send(`${this.role} Game started! The default turn timer is: ${this.settings[defaultTimer.getKey()].print()}.`);
    newsModule.post(`The game ${this.name} (${this.channel}) started!`, this.guild.id);
  }

  else
  {
    rw.log(null, `${this.name}: new turn ${newTimerInfo.turn}! ${this.settings[defaultTimer.getKey()].print()} left for the next turn.`);
    this.channel.send(`${this.role} New turn ${newTimerInfo.turn} is here! ${this.settings[defaultTimer.getKey()].print()} left for the next turn.`);
    newsModule.post(`New turn in ${this.name} (${this.channel}).`, this.guild.id);
  }
}

function announceLastHour(newTimerInfo, cb)
{
  var that = this;
  var undoneCount = 0;
  var unfinishedCount = 0;
  var undoneNations = "The nations below have not yet **checked or done** their turn:\n\n";
  var unfinishedNations = "The nations below have their turn marked as **unfinished** (this is probably fine, and if not, is the players' responsibility):\n\n";

  rw.log(null, this.name + ": 1h or less left for the next turn.");

  this.server.socket.emit("getDump", {name: this.name, port: this.port}, function(err, dump)
  {
    if (err)
    {
      rw.logError({Game: that.name}, `"getDump" slave Error:`, err);
      cb(err, null);
      return;
    }

    for (var nation in dump)
    {
      if (dump[nation].controller != 1)
      {
        continue;
      }

      if (dump[nation].turnPlayed == 0)
      {
        undoneCount++;
        undoneNations += "- " + dump[nation].nationName + "\n";
      }

      else if (dump[nation].turnPlayed == 1)
      {
        unfinishedCount++;
        unfinishedNations += "- " + dump[nation].nationName + "\n";
      }
    }

    if (undoneCount > 0 && unfinishedCount > 0)
    {
      that.channel.send(`${that.role} There are ${newTimerInfo.totalMinutes} minutes left for the new turn. ${undoneNations}\n\n${unfinishedNations}`);
    }

    else if (undoneCount > 0)
    {
      that.channel.send(`${that.role} There are ${newTimerInfo.totalMinutes} minutes left for the new turn. ${undoneNations}`);
    }

    else if (unfinishedCount > 0)
    {
      that.channel.send(`${that.role} There are ${newTimerInfo.totalMinutes} minutes left for the new turn. ${unfinishedNations}`);
    }
  });
}

function save(cb)
{
  var that = this;

  //if directory with game name does not exist, create it.
  if (fs.existsSync(config.pathToGameData + "/" + this.name) == false)
  {
    fs.mkdirSync(config.pathToGameData + "/" + this.name);
  }

  rw.saveJSON(config.pathToGameData + "/" + this.name + "/data.json", this, cb);
}

function saveSettings(cb)
{
  this.server.socket.emit("saveSettings", {name: this.name, port: this.port, args: this.settingsToExeArguments()}, cb);
}

'use strict';
  const archiver = require("archiver"),
  path = require('path'),
  fs = require('fs-extra'),
  fileHelpers = require('./fileHelpers'),
  logger = require("./logger").winstonLogger,
  Constants = require('./constants'),
  process = require('process'),
  utils = require('./utils'),
  { spawn } = require('child_process'),
  util = require('util');

let nodeProcess;

const setupPackageFolder = (runSettings, directoryPath) => {
  return new Promise(function (resolve, reject) {
    fileHelpers.deletePackageArchieve(false);
    logger.debug(`Started creating ${directoryPath} folder`);
    fs.mkdir(directoryPath, function (err) {
      try {
        if (err) {
          return reject(err);
        }
        logger.debug(`Completed creating ${directoryPath}`);
        let packageJSON = {};
        if (typeof runSettings.package_config_options === 'object') {
          Object.assign(packageJSON, runSettings.package_config_options);
        }

        if (typeof runSettings.npm_dependencies === 'object') {
          Object.assign(packageJSON, {
            devDependencies: runSettings.npm_dependencies,
          });
        }

        if (Object.keys(packageJSON).length > 0) {
          let packageJSONString = JSON.stringify(packageJSON);
          let packagePath = path.join(directoryPath, "package.json");
          fs.writeFileSync(packagePath, packageJSONString);
          let cypressFolderPath = path.dirname(runSettings.cypressConfigFilePath);
          let sourceNpmrc = path.join(cypressFolderPath, ".npmrc");
          let destNpmrc = path.join(directoryPath, ".npmrc");
          if (fs.existsSync(sourceNpmrc)) {
            logger.debug(`Copying .npmrc file from ${sourceNpmrc} to ${destNpmrc}`);
            fs.copyFileSync(sourceNpmrc, destNpmrc);
          }
          logger.debug(`${packagePath} file created with ${packageJSONString}`);
          return resolve("Package file created");
        }
        logger.debug("Nothing in package file");
        return reject("Nothing in package file");
      } catch(error) {
        logger.debug(`Creating ${directoryPath} failed with error ${error}`);
        return reject(error);
      }
    })
  })
};

const packageInstall = (packageDir) => {
  return new Promise(function (resolve, reject) {
    const nodeProcessCloseCallback = (code) => {
      if(code == 0) {
        logger.info(`Packages were installed locally successfully.`);
        resolve('Packages were installed successfully.');
      } else {
        logger.error(`Some error occurred while installing packages. Error code ${code}`);
        reject(`Packages were not installed successfully. Error code ${code}`);
      }
    };
    const nodeProcessErrorCallback = (error) => {
      logger.error(`Some error occurred while installing packages: %j`, error);
      reject(`Packages were not installed successfully. Error Description %j`, error);
    };
    nodeProcess = spawn(/^win/.test(process.platform) ? 'npm.cmd' : 'npm', ['install', '--loglevel', 'verbose', '>', '../npm_install_debug.log', '2>&1'], {cwd: packageDir, shell: true});
    nodeProcess.on('close', nodeProcessCloseCallback);
    nodeProcess.on('error', nodeProcessErrorCallback);
  });
};

const packageArchiver = (packageDir, packageFile) => {
  return new Promise(function (resolve, reject) {
    let output = fs.createWriteStream(packageFile);
    let archive = archiver('tar', {
      gzip: true
    });
    archive.on('warning', function (err) {
      if (err.code === 'ENOENT') {
        logger.info(err);
      } else {
        logger.debug(`Archiving of node_modules failed with error ${err}`);
        reject(err);
      }
    });

    output.on('close', function () {
      resolve('Zipping completed');
    });

    output.on('end', function () {
      logger.info('Data has been drained');
    });

    archive.on('error', function (err) {
      logger.debug(`Archiving of node_modules failed with error ${err}`);
      reject(err);
    });

    archive.pipe(output);
    archive.directory(packageDir, false);
    archive.finalize();
  })
}

const packageWrapper = (bsConfig, packageDir, packageFile, md5data, instrumentBlocks) => {
  return new Promise(function (resolve) {
    let obj = {
      packageArchieveCreated: false
    };
    if (md5data.packageUrlPresent || !utils.isTrueString(bsConfig.run_settings.cache_dependencies)) {
      logger.debug("Skipping the caching of npm packages since BrowserStack has already cached your npm dependencies that have not changed since the last run.")
      return resolve(obj);
    }
    logger.info(Constants.userMessages.NPM_INSTALL_AND_UPLOAD);
    instrumentBlocks.markBlockStart("packageInstaller.folderSetup");
    logger.debug("Started setting up package folder");
    return setupPackageFolder(bsConfig.run_settings, packageDir).then((_result) => {
      logger.debug("Completed setting up package folder");
      process.env.CYPRESS_INSTALL_BINARY = 0
      instrumentBlocks.markBlockEnd("packageInstaller.folderSetup");
      instrumentBlocks.markBlockStart("packageInstaller.packageInstall");
      logger.debug("Started installing dependencies specified in browserstack.json");
      return packageInstall(packageDir);
    }).then((_result) => {
      logger.debug("Completed installing dependencies");
      instrumentBlocks.markBlockEnd("packageInstaller.packageInstall");
      instrumentBlocks.markBlockStart("packageInstaller.packageArchive");
      logger.debug("Started archiving node_modules")
      return packageArchiver(packageDir, packageFile);
    }).then((_result) => {
      logger.debug("Archiving of node_modules completed");
      instrumentBlocks.markBlockEnd("packageInstaller.packageArchive");
      Object.assign(obj, { packageArchieveCreated: true });
      return resolve(obj);
    }).catch((err) => {
      logger.warn(`Error occured while caching npm dependencies. Dependencies will be installed in runtime. This will have a negative impact on performance. Reach out to browserstack.com/contact, if you persistantly face this issue.`);
      obj.error = err.stack ? err.stack.toString().substring(0,100) : err.toString().substring(0,100);
      return resolve(obj);
    })
  })
}

exports.packageWrapper = packageWrapper;

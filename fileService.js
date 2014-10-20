/**
 * Handles file transfers
 */
angular.module('greenimp').service('fileService', ['CordovaService', 'deviceService', '$log', '$q', function(CordovaService, deviceService, $log, $q){
  // if no LocalFileSystem has been declared create a dummy object
  if(typeof LocalFileSystem === 'undefined'){
    window.LocalFileSystem = {};
    LocalFileSystem.TEMPORARY = window.TEMPORARY || 0;
    LocalFileSystem.PERSISTENT = window.PERSISTENT || 1;
  }


  var scope         = this,
      rootPath      = deviceService.deviceRootPath(), // the root directory storage path for files
      addRoot       = function(path, root){           // adds the root path (if required) to the given path
        var deferred  = $q.defer(); // the promise

        if(root){
          // we have root, just return the path
          deferred.resolve(path);
        }else{
          // no root - determine it
          rootPath.then(function(rPath){
            if(
              (path != rPath) &&                  // path isn't the rootPath AND
              (path.indexOf('/') != 0) &&         // path doesn't start with '/' AND
              (path.indexOf(rPath + '/') != 0) && // path doesn't start with the root path already
              !pathHasProtocol(path)       // path doesn't start with a protocol declaration (ie; `file://`, `content://`)
            ){
              // pre-pend the root to the path
              path = rPath + '/' + path;
            }

            // return the path
            deferred.resolve(path);
          });
        }

        // return the promise
        return deferred.promise;
      },
      fileSystem,                                     // holds a reference to the last used file system
      fileTransfer,                                   // file transfer object
      errorCodes    = {                               // list of human readable versions of error codes
        file: {},     // errors for the file system (reading directories etc)
        transfer: {}  // error for file transfers (these are defined in getFileTransferObj, as they're not available until the object is)
      };

  // define the errors for files
  if(typeof FileError !== 'undefined'){
    errorCodes.file[FileError.NOT_FOUND_ERR]                = 'File not found';
    errorCodes.file[FileError.SECURITY_ERR]                 = 'Security error';
    errorCodes.file[FileError.ABORT_ERR]                    = 'Aborted';
    errorCodes.file[FileError.NOT_READABLE_ERR]             = 'Not readable';
    errorCodes.file[FileError.ENCODING_ERR]                 = 'Encoding error';
    errorCodes.file[FileError.NO_MODIFICATION_ALLOWED_ERR]  = 'No modification allowed';
    errorCodes.file[FileError.INVALID_STATE_ERR]            = 'Invalid state';
    errorCodes.file[FileError.SYNTAX_ERR]                   = 'Syntax error';
    errorCodes.file[FileError.INVALID_MODIFICATION_ERR]     = 'Invalid modification';
    errorCodes.file[FileError.QUOTA_EXCEEDED_ERR]           = 'Quota exceeded';
    errorCodes.file[FileError.TYPE_MISMATCH_ERR]            = 'Type mismatch';
    errorCodes.file[FileError.PATH_EXISTS_ERR]              = 'Path does not exist';
  }


  /**
   * Checks whether the path has a protocol assigned
   * (ie; `file://`, `content://`)
   *
   * @param path
   * @returns {boolean}
   */
  var pathHasProtocol = function(path){
    return /^[a-zA-Z]+:\/\//.test(path);
  };

  /**
   * Downloads a file
   *
   * @param {FileTransfer} fileTransferObj
   * @param {string} from
   * @param {string} to
   * @param {object=} options
   * @param {number=} attempts              The number of tries to download a file, if it fails
   * @param {number=} attemptCount          The number of attempts already made
   */
  var doDownloadFile = function(fileTransferObj, from, to, options, attempts, attemptCount){
    var deferred  = $q.defer(); // the promise

    // ensure that the attempt counters are numerical
    attempts      = (isNumeric(attempts) && (attempts > 0)) ? attempts : 3;
    attemptCount  = (isNumeric(attemptCount) && (attemptCount >= 0)) ? attemptCount : 0;

    $log.log('Downloading file (Attempt ' + (attemptCount+1) + '):', from, to);

    // start the download
    fileTransfer.download(
      from,
      to,
      // success callback
      function(file){
        $log.log('Download complete:', from, file.toURL());
        deferred.resolve(file);
      },
      // error callback
      function(error){
        // increment the attempt count
        attemptCount++;

        $log.warn(
          'File download error (Attempt: ' + attemptCount + '):\n' +
          (errorCodes.transfer[error.code] || 'Unknown') + ' (' + error.code + ')\n' +
          'Status: ' + error.http_status + '\n' +
          'Source: ' + error.source + '\n' +
          'Target: ' + error.target
        );

        if(attemptCount <= attempts){
          // make another attempt
          $log.log('Re-trying download:', error.source, to);
          doDownloadFile(fileTransferObj, from, to, options, attempts, attemptCount).then(deferred.resolve, deferred.reject);
        }else{
          // we don't want to make any more attempts
          deferred.reject('Error downloading file (' + error.source.substring(0, 100) + '...): ' + errorCodes.transfer[error.code]);
        }
      },
      false,
      options
    );

    // return the promise
    return deferred.promise;
  };


  /**
   * Check if the given file
   * is a FileEntry object
   *
   * @param {*} file
   * @returns {boolean}
   */
  var isFileEntryObject = function(file){
    return isInstanceOf(file, FileEntry);
  };

  /**
   * Check if the given file
   * is a File object
   *
   * @param {*} file
   * @returns {boolean}
   */
  var isFileObject = function(file){
    return isInstanceOf(file, File);
  };


  /**
   * Returns a promise for a file system
   *
   * @param type
   * @param size
   * @returns {promise}
   */
  this.requestFileSystem = function(type, size){
    var deferred  = $q.defer();

    if(fileSystem && !type && !size){
      // we already have a file system and no specific
      // one has been requested - just return it
      deferred.resolve(fileSystem);
    }else{
      // we don't have a file system yet or a specific
      // one has been requested - request one

      // we need to wait for Cordova to be ready
      CordovaService.ready.then(
        // success callback
        function(){
          if(!window.requestFileSystem){
            $log.warn('`requestFileSystem` is undefined - ensure that the `File` plugin is installed');
            deferred.reject('Local File System is not defined');
            return;
          }

          window.requestFileSystem(
            // storage type (temporary or permanent)
            (type == LocalFileSystem.TEMPORARY) ? LocalFileSystem.TEMPORARY : LocalFileSystem.PERSISTENT,
            // required size (0 == unsure)
            size || 0,
            // success callback
            function(fileSys){
              fileSystem = fileSys;
              deferred.resolve(fileSystem);
            },
            // error callback
            function(e){
              $log.warn('File system error: ' + e.target.error.code);
              deferred.reject('Error getting file system (' + e.target.error.code + ')');
            }
          );
        },
        // error callback
        deferred.reject
      );
    }

    return deferred.promise;
  };

  /**
   * Returns a promise for a File Transfer object.
   * Although FileTransfer is a synchronous constructor,
   * it relies on device ready being fired, so we have a
   * promise to wait for this
   *
   * @returns {promise}
   */
  this.getFileTransferObj = function(){
    var deferred  = $q.defer();

    if(fileTransfer){
      deferred.resolve(fileTransfer);
    }else{
      // we need to wait for Cordova to be ready
      CordovaService.ready.then(
        // success callback
        function(){
          // this is the first time that we've got the file transfer object - this means that we can initialise the error messages for it
          errorCodes.transfer[FileTransferError.FILE_NOT_FOUND_ERR] = 'File not found';
          errorCodes.transfer[FileTransferError.INVALID_URL_ERR]    = 'Invalid URL';
          errorCodes.transfer[FileTransferError.CONNECTION_ERR]     = 'Connection error';
          errorCodes.transfer[FileTransferError.ABORT_ERR]          = 'Transfer aborted';

          // initialise the FileTransfer object and resolve with it
          fileTransfer = new FileTransfer();
          deferred.resolve(fileTransfer);
        },
        // error callback
        deferred.reject
      );
    }

    return deferred.promise;
  };

  /**
   * Gets a directory and returns it's pointer
   *
   * @param path
   * @param root
   * @returns {promise}
   */
  this.getDirectory = function(path, root){
    var deferred  = $q.defer();

    // get the file system
    scope.requestFileSystem().then(
      // success callback
      function(fileSystem){
        // ensure that the path starts with root, if we've not defined a root
        addRoot(path, root).then(function(newPath){
          // set the path
          path = newPath;

          // open the directory
          (root || fileSystem.root).getDirectory(
            path,
            {create: true, exclusive: false},
            // success callback - just call our deferred resolve with our directory entry
            deferred.resolve,
            // error callback
            function(error){
              // add root to path, if defined (purely for easing debugging)
              path = root ? root.fullPath + '/' + path : path;

              $log.warn('Error getting directory: ' + path + '\n' + (errorCodes.file[error.code] || 'Unknown') + ' (' + error.code + ')');

              // return the error to the user
              deferred.reject('Failed to retrieve directory (' + path + '): ' + (errorCodes.file[error.code] || 'Unknown'));
            }
          );
        });
      },
      // error callback
      deferred.reject
    );

    return deferred.promise;
  };

  /**
   * Recursively creates/gets a directory structure
   * and returns the final created/found directory
   *
   * @param path
   * @param root
   * @returns {promise}
   */
  this.getDirectoryRecursive = function(path, root){
    var deferred  = $q.defer(); // the promise

    // add the root to the path
    addRoot(path, root).then(function(pathWRoot){
      // try to get the directory without recursive first (quicker if directory exists)
      scope.getDirectory(pathWRoot, root).then(
        // success callback - resolve with the entry
        deferred.resolve,
        // error callback
        function(){
          // failed to find the directory - attempt to recursively create it
          var dirs  = path.split('/'); // list of directories to be created

          // get the directory
          scope.getDirectory(dirs.shift(), root).then(
            // success callback
            function(file){
              if(dirs.length){
                // still more directories to be created
                // call this function again, without the created directory in the file path but pass through
                // the file as the new root (rather than default root dir).
                // If the function is rejected, it recursively calls the reject methods from
                // the previous directory creations.
                // If the directory is created successfully, two things could happen:
                //  1. If it is the last one directory, it recursively calls the resolve methods from the previous
                //     directory creations.
                //  2. If there are more directories to create, it re-calls this function again, and repeats.
                scope.getDirectoryRecursive(dirs.join('/'), file).then(
                  deferred.resolve,
                  deferred.reject
                );
              }else{
                // no directories left to create - resolve the promise
                deferred.resolve(file);
              }
            },
            // error callback
            deferred.reject
          );
        }
      );
    });

    // return the promise
    return deferred.promise;
  };

  /**
   * Returns a promise for a list of
   * files in the given directory
   *
   * @param dir
   * @returns {promise}
   */
  this.getFilesInDirectory = function(dir){
    var deferred  = $q.defer(); // the promise

    // get the directory - if `dir` is a string, then we call `getDirectory` on it
    // using `when` as the variable may or may not be a promise
    $q.when((typeof dir === 'string') ? scope.getDirectory(dir) : dir).then(
      // success callback
      function(entry){
        // create the directory reader and get a list of files
        entry.createReader().readEntries(
          // success callback - return the list of entries
          deferred.resolve,
          // error callback
          function(error){
            $log.warn('Error getting file list: ' + entry.fullPath + '\n' + errorCodes.file[error.code] + ' (' + error.code + ')');
            deferred.reject('Failed to retrieve file list for ' + entry.name + ': ' + errorCodes.file[error.code]);
          }
        );
      },
      // error callback
      deferred.reject
    );

    return deferred.promise;
  };

  /**
   * Returns a promise for the file entry
   * at the given path
   *
   * @param path
   * @param root
   * @param {Object=} options
   * @returns {promise}
   */
  this.getFileEntry = function(path, root, options){
    options = options || {create: false};
    var deferred  = $q.defer(); // the promise

    if(pathHasProtocol(path)){
      window.resolveLocalFileSystemURL(
        path,
        // success callback
        deferred.resolve,
        // error callback
        function(error){
          error.message = 'Failed to retrieve file (' + path + '): ' + errorCodes.file[error.code];
          deferred.reject(error);
        }
      );
    }else{
      // get the file system
      scope.requestFileSystem().then(
        // success callback
        function(fileSystem){
          // ensure that the path has a root directory
          path = addRoot(path, root).then(function(newPath){
            // set the path
            path = newPath;

            // get the file
            (root || fileSystem.root).getFile(
              path,
              options,
              // success callback - just pass the deferred resolve with our file entry
              deferred.resolve,
              // error callback
              function(error){
                error.message = 'Failed to retrieve file (' + path + '): ' + errorCodes.file[error.code];
                deferred.reject(error);
              }
            );
          });
        },
        //error callback
        deferred.reject
      );
    }

    // return the promise
    return deferred.promise;
  };

  /**
   * Returns a promise for the file
   * at the given path.
   * fileEntry can be a path to a file
   * or a FileEntry object.
   *
   * @param {FileEntry|string} fileEntry
   * @returns {promise}
   */
  this.getFile = function(fileEntry){
    var deferred  = $q.defer(); // the promise

    if(isFileEntryObject(fileEntry)){
      // we have a file entry object - get the file
      fileEntry.file(deferred.resolve, deferred.reject);
    }else{
      // we don't have a file entry object - get one
      scope.getFileEntry(fileEntry).then(
        // success callback
        function(fileEntry){
          // we have the file entry - get the file
          scope.getFile(fileEntry).then(deferred.resolve, deferred.reject);
        },
        // error callback
        deferred.reject
      );
    }

    // return the promise
    return deferred.promise;
  };

  /**
   * Checks whether the given file exists or not.
   * Returns a promise for the value.
   *
   * @param {string} path
   * @returns {promise}
   */
  // TODO - test fileExists functionality
  this.fileExists = function(path){
    return scope.getFileEntry(path).then(
      function(){
        // file was found
        return true;
      },
      function(error){
        // error getting file
        return false;
      }
    );
  };

  /**
   * Downloads the file at the given URL and stores it
   * in the path.
   * If no fileName is defined, it is taken from the URL.
   *
   * @param {string} url
   * @param {string} path
   * @param {string=} fileName
   * @param {object=} options
   * @param {number=} attempts  The number of tries to download a file, if it fails (defaults to 3)
   * @returns {promise}
   */
  this.downloadFile = function(url, path, fileName, options, attempts){
    var deferred  = $q.defer(); // the promise

    // get the required data
    $q.all([
      scope.getDirectoryRecursive(path),  // get the directory to store files
      scope.getFileTransferObj()          // get the file transfer object
    ]).then(
      // success callback
      function(data){
        var dir           = data[0],  // file directory
            fileTransfer  = data[1];  // file transfer object

        fileName = fileName || url.match(/[\d\w\-_\.]+\.[a-z]+$/)[0] || 'unknown';

        // start the download
        doDownloadFile(
          fileTransfer,
          url,
          rTrim(dir.toURL(), '/') + '/' + fileName,
          options,
          attempts
        ).then(deferred.resolve, deferred.reject);
      },
      // error callback
      deferred.reject
    );

    // return the promise
    return deferred.promise;
  };

  /**
   * Uploads a local file to an external server
   *
   * @param {string} filePath
   * @param {string} serverURL
   * @param {string} fileName
   * @param {*=} options
   * @param {boolean=} trustAll
   * @returns {promise}
   */
  this.uploadFile = function(filePath, serverURL, fileName, options, trustAll){
    var deferred  = $q.defer(); // the promise

    if(!fileName){
      // no filename defined
      deferred.reject('No filename defined for Upload');
    }else{
      $log.log('Uploading file:', filePath, serverURL, fileName);

      // get the required data
      $q.all([
        scope.getFileEntry(filePath),    // get the file to upload
        scope.getFileTransferObj()  // get the file transfer object
      ]).then(
        // success callback
        function(data){
          var fileEntry     = data[0],  // the local file
              fileTransfer  = data[1];  // file transfer object

          // ensure that we have an options object
          options = options || {};
          options.fileName = fileName;  // define the new filename

          // get the file mime type
          scope.getFileMimeType(fileEntry)
            .then(
              // success callback
              function(mime){
                options.mimeType = mime || options.mimeType || '';
              },
              // error callback
              deferred.reject
            )
            .finally(function(){
              // upload the file
              fileTransfer.upload(
                fileEntry.toNativeURL(),
                serverURL,
                // success callback
                function(metadata){
                  $log.log('Upload complete: ', fileEntry.toNativeURL(), serverURL, fileName);
                  deferred.resolve(metadata);
                },
                // error callback
                deferred.reject,
                // options
                options,
                !!trustAll
              );
            });
        },
        // error callback
        function(error){
          $log.warn(
            'File upload error:\n' +
            (errorCodes.transfer[error.code] || 'Unknown') + ' (' + error.code + ')\n' +
            'Status: ' + error.http_status + '\n' +
            'Source: ' + error.source + '\n' +
            'Target: ' + error.target
          );

          deferred.reject('Error uploading file (' + error.target.substring(0, 100) + '...): ' + errorCodes.transfer[error.code]);
        }
      );
    }

    // return the promise
    return deferred.promise;
  };

  /**
   * Copies a file to another location
   *
   * @param {string} from
   * @param {string} to
   * @param {string=} newName
   * @returns {|promise}
   */
  this.copyFile = function(from, to, newName){
    var deferred  = $q.defer(); // the promise

    $log.log('Copying file:', from, to, newName);

    $q.all([
      scope.getFileEntry(from),       // get the file
      scope.getDirectoryRecursive(to) // get the directory to copy to
    ]).then(
      // success callback
      function(data){
        var fileEntry = data[0],  // the file
            dir       = data[1];  // the directory to copy to

        // we have the file - copy it to the new location
        fileEntry.copyTo(
          dir,
          newName,
          // success callback
          function(newFile){
            $log.log('Copy complete:', from, newFile.toURL());
            deferred.resolve(newFile);
          },
          // error callback
          function(reason){
            $log.warn('Error copying file (' + errorCodes.file[reason.code] + '):', from, to, newName, reason);
            deferred.reject(reason);
          }
        );
      },
      // error callback
      function(reason){
        $log.warn('Error getting file to copy (' + errorCodes.file[reason.code] + '):', from, to, newName, reason);
        deferred.reject(reason);
      }
    );

    // return the promise
    return deferred.promise;
  };

  /**
   * Moves a file to another location
   *
   * @param {string} from
   * @param {string} to
   * @param {string=} newName
   * @returns {|promise}
   */
  this.moveFile = function(from, to, newName){
    var deferred  = $q.defer(); // the promise

    $log.log('Moving file:', from, to, newName);

    $q.all([
      scope.getFileEntry(from),       // get the file
      scope.getDirectoryRecursive(to) // get the directory to copy to
    ]).then(
      // success callback
      function(data){
        var fileEntry = data[0],  // the file
            dir       = data[1];  // the directory to copy to

        // we have the file - move it to the new location
        fileEntry.moveTo(
          dir,
          newName,
          // success callback
          function(newFile){
            $log.log('Move complete:', from, newFile.toURL());
            deferred.resolve(newFile);
          },
          // error callback
          function(reason){
            $log.warn('Error moving file (' + errorCodes.file[reason.code] + '):', from, to, newName, reason);
            deferred.reject(reason);
          }
        );
      },
      // error callback
      function(reason){
        $log.warn('Error getting file to move (' + errorCodes.file[reason.code] + '):', from, to, newName, reason);
        deferred.reject(reason);
      }
    );

    // return the promise
    return deferred.promise;
  };


  /**
   * Returns the file name.
   * `file` can be a FileEntry or File object
   * or a string containing a file path
   *
   * @param {FileEntry|File|string} file
   * @returns {string}
   */
  this.getFileName = function(file){
    if(isFileObject(file) || isFileEntryObject(file)){
      // file is a File or FileEntry object - use it's name object
      return file.name;
    }else{
      return (file || '').split('/').pop();
    }
  };

  /**
   * Returns the file extension from the filename
   * @param {string} fileName
   * @param {boolean=} toLower
   * @param {boolean=} includeDot
   * @returns {boolean|string|string}
   */
  this.getFileExtension = function(fileName, toLower, includeDot){
    var ext = scope.getFileName(fileName) // ensure that fileName doesn't contain directory structure
              .split('.');                // get the file extension

    // check the extension
    if(
      (ext.length === 1) || // file has no extension OR
      (                     // file is a hidden file (starts with a '.'. ie. '.hidden')
        (ext[0] === '') &&
        (ext.length === 2)
      )
    ){
      // no file extension
      return '';
    }


    // get the last section
    ext = ext.pop();

    // convert the extension to lower case
    if(toLower){
      ext = ext.toLowerCase();
    }

    // return the extension
    return (includeDot ? '.' : '') + ext;
  };

  /**
   * Attempts to guess the file extension
   * that is relevant to the file.
   * This is useful if none is currently
   * defined in the file name.
   * Returns a promise for the request.
   *
   * @param file
   * @param includeDot
   * @returns {promise}
   */
  this.guessFileExtension = function(file, includeDot){
    var deferred  = $q.defer(); // the promise

    scope.getFileMimeType(file, true).then(
      // success callback
      function(mimeType){
        // TODO - this should use an external comparison file
        var ext = '';

        switch(mimeType){
          case 'image/jpeg':
            ext = 'jpg';
          break;
          case 'video/mp4':
          case 'video/3gpp':
            ext = 'mp4';
          break;
          case 'video/quicktime':
            ext = 'mov';
          break;
          case 'audio/3gpp':
            ext = '3gpp';
          break;
          case 'audio/wav':
            ext = 'wav';
          break;
          case 'audio/amr':
            ext = 'amr';
          break;
          default:
            // no mime type (or mime type not recognised)
            ext = '';
          break;
        }

        // return the extension
        deferred.resolve((ext && includeDot) ? '.' + ext : ext);
      },
      // error function
      function(){
        // unable to determine mime type
        deferred.resolve('');
      }
    );

    // return the promise
    return deferred.promise;
  };

  /**
   * Returns a promise for the mime
   * type of the given file
   *
   * @param {FileEntry|File|string} file
   * @param {boolean=} dontGuess
   * @returns {promise}
   */
  this.getFileMimeType = function(file, dontGuess){
    var deferred  = $q.defer(); // the promise

    if(isFileObject(file)){
      // get the mime type
      if(file.type){
        // we have a mime type - return it
        deferred.resolve(file.type);
      }else if(!dontGuess){
        // no mime type found - attempt to guess it
        scope.guessFileMimeType(file.name).then(deferred.resolve, deferred.reject);
      }else{
        // no mime type found - don't try to guess it
        deferred.resolve('');
      }
    }else{
      // file isn't a File object - try to get it
      scope.getFile(file).then(
        // success callback
        function(f){
          // file found - get the mime type
          scope.getFileMimeType(f).then(deferred.resolve, deferred.reject);
        },
        // error callback
        function(reason){
          // error getting file - return empty mime type
          deferred.resolve('');
        }
      );
    }

    // return the promise
    return deferred.promise;
  };

  /**
   * Attempts to guess the files mime
   * type, based on file extension.
   * Returns a promise for the request.
   *
   * @param {FileEntry|File|string} file
   * @returns {promise}
   */
  this.guessFileMimeType = function(file){
    var deferred  = $q.defer(); // the promise

    // TODO - this should use an external comparison file
    var mimeType = '';
    switch(scope.getFileExtension(file, true)){
      case 'jpe':
      case 'jpeg':
      case 'jpg':
        mimeType = 'image/jpeg';
      break;
      case 'mp4':
      case 'mp4v':
      case 'mpg4':
        mimeType = 'video/mp4';
      break;
      case 'moov':
      case 'mov':
      case 'qt':
        mimeType = 'video/quicktime';
      break;
      case '3gpp':
        // this could be audio or video
        mimeType = 'audio/3gpp';
      break;
      case 'wav':
        mimeType = 'audio/wav';
      break;
      case 'amr':
        mimeType = 'audio/amr';
      break;
      default:
        // no extension (or extension not recognised) - return empty mime type
        mimeType = '';
      break;
    }

    // resolve with the mime type
    deferred.resolve(mimeType);

    // return the promise
    return deferred.promise;
  };


  /**
   * Returns the cache directory for the order
   *
   * @param orderID
   * @returns {string}
   */
  this.getCacheDir = function(orderID){
    return 'cache/' + orderID + '/';
  };
}]);

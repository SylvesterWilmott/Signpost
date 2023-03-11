'use strict'

const { app, Menu, Tray, BrowserWindow, dialog, nativeImage, screen, shell, systemPreferences, ipcMain } = require('electron')

const fs = require('fs')
const path = require('path')
const Store = require('electron-store')
const { autoUpdater } = require('electron-updater')
const strings = require(path.join(__dirname, 'strings.json'))

const defaults = {
  favourites: [],
  pref_icon_size: 'small',
  pref_sort: 'type',
  pref_action: 'submenu',
  pref_open_at_login: false,
  flag_first_launch: true
}

const storage = new Store({ defaults })

let tray
let menu
let welcomeWin
let preferencesWin
let dialogIsOpen = false
const storedData = {}

app.on('ready', async function () {
  app.dock.hide()
  getUserPrefs()
  setupTray()
  await buildMenu()
  registerListeners()
  setupAppSettings()
  autoUpdater.checkForUpdatesAndNotify()
  showWelcomeWindowIfNeeded()

  // Prevent app from closing completely if all windows are closed
  app.on('window-all-closed', (e) => {
    e.preventDefault()
  })
})

function getUserPrefs () {
  for (const key in defaults) {
    storedData[key] = storage.get(key)
  }
}

function setupTray () {
  tray = new Tray(path.join(__dirname, 'images', 'ic_Template.png'))
}

async function buildMenu () {
  const menuTemplate = []

  if (storedData.pref_sort === 'type') {
    storedData.favourites.sort((a, b) => {
      const order = { app: 1, dir: 2, file: 3 }
      return order[a.type] - order[b.type]
    })
  } else if (storedData.pref_sort === 'name') {
    storedData.favourites.sort((a, b) => a.name.localeCompare(b.name))
  }

  const addTemplate = [
    {
      label: strings.ADD,
      accelerator: 'Command+N',
      click: () => chooseFavourite()
    },
    { type: 'separator' }
  ]

  const otherTemplate = [
    {
      label: strings.PREFERENCES,
      accelerator: 'Command+,',
      click: () => showPreferencesWindow()
    },
    { type: 'separator' },
    {
      role: 'quit',
      label: strings.QUIT,
      accelerator: 'Command+Q'
    }
  ]

  menuTemplate.push(addTemplate)
  if (storedData.favourites.length) {
    const map = await Promise.all(
      storedData.favourites.map(getFavouriteMenuItem)
    )

    const favouritesTemplate = [...map, { type: 'separator' }]

    menuTemplate.push(favouritesTemplate)
  }
  menuTemplate.push(otherTemplate)

  const finalTemplate = Array.prototype.concat(...menuTemplate)

  menu = Menu.buildFromTemplate(finalTemplate)
  tray.setContextMenu(menu)
}

function chooseFavourite () {
  if (dialogIsOpen === false) {
    dialogIsOpen = true
    dialog
      .showOpenDialog({
        message: strings.CHOOSE_PROMPT,
        buttonLabel: strings.CHOOSE,
        properties: ['openFile', 'openDirectory', 'multiSelections']
      })
      .then((result) => {
        if (result.canceled) {
          dialogIsOpen = false
          return
        }

        addToFavourites(result.filePaths)
        dialogIsOpen = false
      })
      .catch((err) => {
        console.log(err)
        dialogIsOpen = false
      })
  }
}

function addToFavourites (filePaths) {
  const newFavourites = []
  const rejected = []

  for (const f of filePaths) {
    const isAFavourite = storedData.favourites.find((x) => x.path === f)

    if (isAFavourite) {
      rejected.push(f)
    } else {
      newFavourites.push(f)
    }
  }

  if (rejected.length) {
    const rejectedArr = []

    for (const item of rejected) {
      const baseName = path.basename(item)
      rejectedArr.push(baseName)
    }

    const rejectedArrToStr =
      rejectedArr.length > 1
        ? rejectedArr.slice(0, -1).join(',') + ' and ' + rejectedArr.slice(-1)
        : rejectedArr.toString()

    const rejectedStr =
      rejectedArr.length > 1
        ? `The files "${rejectedArrToStr}" were already added`
        : `The file "${rejectedArrToStr}" is already added`

    dialog
      .showMessageBox({
        message: strings.ALREADY_EXISTS,
        detail: rejectedStr,
        type: 'info',
        buttons: ['OK'],
        defaultId: 0
      })
      .then(() => {
        updateUserFavourites(newFavourites)
      })
      .catch((err) => {
        console.log(err)
      })

    return
  }

  updateUserFavourites(newFavourites)
}

function updateUserFavourites (newFavourites) {
  const updatedFavourites = [...storedData.favourites]

  for (const f of newFavourites) {
    const favourite = getFavouriteObj(f)
    updatedFavourites.push(favourite)
  }

  storage.set('favourites', updatedFavourites)
}

function getFavouriteObj (filePath) {
  const name = path.parse(filePath).name
  const ext = path.extname(filePath).toLowerCase()
  const truncated = getTruncatedFilename(name, ext)

  const favourite = {
    name: truncated,
    path: filePath
  }

  if (ext === '.app') {
    favourite.type = 'app'
  } else if (isDir(filePath)) {
    favourite.type = 'dir'
  } else {
    favourite.type = 'file'
  }

  return favourite
}

function isDir (filePath) {
  try {
    const stat = fs.lstatSync(filePath)
    return stat.isDirectory()
  } catch (e) {
    return false
  }
}

function getTruncatedFilename (name, ext) {
  const maxChars = 25

  if (name.length > maxChars) {
    const start = name.substring(0, maxChars / 2).trim()
    const end = name.substring(name.length - maxChars / 2, name.length).trim()
    return `${start}...${end}${ext}`
  }

  if (ext === '.app') return `${name}`

  return `${name}${ext}`
}

function clearFavourites (winId) {
  if (storedData.favourites.length === 0) return

  let parentWindow = null
  if (winId) parentWindow = BrowserWindow.fromId(winId)

  dialog
    .showMessageBox(parentWindow, {
      message: strings.CLEAR_QUESTION_TITLE,
      detail: strings.CLEAR_QUESTION_DETAIL,
      buttons: [strings.CLEAR_QUESTION_BUTTON_POSITIVE, strings.CLEAR_QUESTION_BUTTON_NEGATIVE],
      type: 'warning',
      defaultId: 1,
      cancelId: 1
    })
    .then((result) => {
      if (result.response === 0) {
        const updatedFavourites = []
        storage.set('favourites', updatedFavourites)
        shell.beep()
      }
    })
    .catch((err) => {
      console.log(err)
    })
}

async function getFavouriteMenuItem (obj, i) {
  const subMenuItem = []

  const open = {
    label: strings.OPEN,
    click: () => handleFile(obj.path, i, 'open')
  }

  const show = {
    label: strings.OPEN_IN_FOLDER,
    click: () => handleFile(obj.path, i, 'show')
  }

  const remove = {
    label: strings.REMOVE,
    click: () => removeFavourite(i)
  }

  if (obj.type === 'dir') {
    subMenuItem.push(open, { type: 'separator' }, remove)
  } else {
    subMenuItem.push(open, show, { type: 'separator' }, remove)
  }

  let menuItem

  if (storedData.pref_action === 'submenu') {
    menuItem = {
      label: obj.name,
      submenu: subMenuItem
    }
  } else if (storedData.pref_action === 'open') {
    menuItem = {
      label: obj.name,
      click: (e) => {
        if (e.shiftKey) {
          removeFavourite(i)
        } else {
          handleFile(obj.path, i, 'open')
        }
      }
    }
  } else if (storedData.pref_action === 'finder') {
    menuItem = {
      label: obj.name,
      click: (e) => {
        if (e.shiftKey) {
          removeFavourite(i)
        } else {
          handleFile(obj.path, i, 'show')
        }
      }
    }
  }

  if (obj.type === 'dir') {
    const icon = await getThumbnail(obj.path)
    if (icon) menuItem.icon = icon
  } else if (obj.type === 'app') {
    const icon = await getAppIcon(obj.path)
    if (icon) menuItem.icon = icon
  } else {
    const icon = await getFileIcon(obj.path)
    if (icon) menuItem.icon = icon
  }

  return menuItem
}

async function getAppIcon (appPath) {
  let icon = null
  let iconPath = null

  const contentsPath = path.join(appPath, 'Contents')
  const resourcesPath = path.join(contentsPath, 'Resources')

  if (fs.existsSync(resourcesPath)) {
    const files = fs.readdirSync(resourcesPath)

    for (const f of files) {
      const ext = path.extname(f)

      if (ext === '.icns') {
        iconPath = path.join(resourcesPath, f)
        break
      }
    }
  }

  if (iconPath) {
    icon = await getThumbnail(iconPath)
  } else {
    icon = await getFileIcon(appPath)
  }

  return icon
}

async function getThumbnail (filePath) {
  let icon = null

  try {
    if (storedData.pref_icon_size === 'small') {
      icon = await nativeImage.createThumbnailFromPath(filePath, {
        width: 16,
        height: 16
      })
    } else if (storedData.pref_icon_size === 'big') {
      icon = await nativeImage.createThumbnailFromPath(filePath, {
        width: 32,
        height: 32
      })
    }
  } catch (err) {
    console.log(err)
  }

  return icon
}

async function getFileIcon (filePath) {
  let icon = null

  try {
    if (storedData.pref_icon_size === 'small') {
      icon = await app.getFileIcon(filePath, { size: 'small' })
    } else if (storedData.pref_icon_size === 'big') {
      icon = await app.getFileIcon(filePath, { size: 'normal' })
    }
  } catch (err) {
    console.log(err)
  }

  return icon
}

function handleFile (filePath, i, action) {
  if (!fs.existsSync(filePath)) {
    dialog
      .showMessageBox({
        message: strings.FILE_NOT_FOUND,
        detail: strings.FILE_NOT_FOUND_DETAIL,
        type: 'question',
        buttons: [strings.FIND_FILE, strings.REMOVE],
        defaultId: 0
      })
      .then((result) => {
        if (result.response === 0) {
          findFile(i)
        } else if (result.response === 1) {
          removeFavourite(i)
        }
      })
      .catch((err) => {
        console.log(err)
      })

    return
  }

  if (action === 'open') {
    shell.openPath(filePath)
  } else {
    shell.showItemInFolder(filePath)
  }
}

function findFile (i) {
  if (dialogIsOpen === false) {
    dialogIsOpen = true
    dialog
      .showOpenDialog({
        message: strings.CHOOSE_PROMPT,
        buttonLabel: strings.CHOOSE,
        properties: ['openFile', 'openDirectory']
      })
      .then((result) => {
        if (result.canceled) {
          dialogIsOpen = false
          return
        }

        const newFilepath = result.filePaths[0]
        const updatedFavourites = [...storedData.favourites]
        const newFavourite = getFavouriteObj(newFilepath)

        updatedFavourites[i] = newFavourite

        storage.set('favourites', updatedFavourites)

        dialogIsOpen = false
      })
      .catch((err) => {
        console.log(err)
        dialogIsOpen = false
      })
  }
}

function removeFavourite (i) {
  if (i > -1) {
    const updatedFavourites = [...storedData.favourites]
    updatedFavourites.splice(i, 1)
    storage.set('favourites', updatedFavourites)
  }
}

function registerListeners () {
  ipcMain.on('updatePreferences', (e, data) => {
    const key = data.key
    const value = data.value

    storage.set(key, value)
  })

  ipcMain.on('rendererButtonClicked', (e, data) => {
    const id = data

    switch (id) {
      case 'clear_all':
        clearFavourites(e.sender.id)
        break
      case 'close_welcome_window':
        if (welcomeWin) {
          welcomeWin.close()
          welcomeWin = null
        }
        break
    }
  })

  tray.on('drop-files', (e, files) => {
    addToFavourites(files)
  })

  tray.on('drag-enter', () => {
    tray.setImage(path.join(__dirname, 'images', 'ic_drop_Template.png'))
  })

  tray.on('drag-leave', () => {
    tray.setImage(path.join(__dirname, 'images', 'ic_Template.png'))
  })

  tray.on('drag-end', () => {
    tray.setImage(path.join(__dirname, 'images', 'ic_Template.png'))
  })

  storage.onDidAnyChange((result) => {
    for (const key in defaults) {
      storedData[key] = result[key]
    }
  })

  storage.onDidChange('favourites', () => {
    buildMenu()
  })

  storage.onDidChange('pref_icon_size', () => {
    buildMenu()
  })

  storage.onDidChange('pref_sort', () => {
    buildMenu()
  })

  storage.onDidChange('pref_action', () => {
    buildMenu()
  })

  storage.onDidChange('pref_open_at_login', (status) => {
    setLoginSettings(status)
  })

  systemPreferences.subscribeNotification(
    'AppleAquaColorVariantChanged',
    () => {
      setTimeout(() => {
        const accentColor = getAccentColor()
        if (welcomeWin) {
          welcomeWin.webContents.send('updateAccentColor', accentColor)
        }
        if (preferencesWin) {
          preferencesWin.webContents.send('updateAccentColor', accentColor)
        }
      }, 250)
    }
  )
}

function setupAppSettings () {
  const openAtLoginStatus = app.getLoginItemSettings().openAtLogin

  if (openAtLoginStatus !== storedData.pref_open_at_login) {
    setLoginSettings(storedData.pref_open_at_login)
  }
}

function setLoginSettings (status) {
  app.setLoginItemSettings({
    openAtLogin: status
  })
}

function getAccentColor () {
  const hexRgba = systemPreferences.getAccentColor()

  if (hexRgba) {
    return hexRgba.slice(0, -2)
  } else {
    return null
  }
}

function showWelcomeWindowIfNeeded () {
  // check if the application is being launched for the first time
  if (storedData.flag_first_launch === false) return

  // then update the flag
  storage.set('flag_first_launch', false)

  welcomeWin = new BrowserWindow({
    width: 380,
    height: 500,
    vibrancy: 'window',
    fullscreenable: false,
    resizable: false,
    frame: false,
    show: false,
    alwaysOnTop: true,
    minimizable: false,
    hiddenInMissionControl: true,
    webPreferences: {
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js'),
      spellcheck: true
    }
  })

  preventZoom(welcomeWin)

  welcomeWin.loadFile(path.join(__dirname, 'welcome', 'welcome.html'))

  welcomeWin.once('ready-to-show', () => {
    welcomeWin.show()
  })

  welcomeWin.on('closed', () => {
    welcomeWin = null
  })

  welcomeWin.webContents.on('did-finish-load', () => {
    const accentColor = getAccentColor()
    if (accentColor) {
      welcomeWin.webContents.send('updateAccentColor', accentColor)
    } // If no accent color then send nothing / theme.css will take care of the fallback
    welcomeWin.webContents.send('loadPreferences', storedData)
  })

  welcomeWin.on('blur', () => {
    welcomeWin.webContents.send('stateChange', 'blur')
  })

  welcomeWin.on('focus', () => {
    welcomeWin.webContents.send('stateChange', 'focus')
  })
}

function showPreferencesWindow () {
  if (preferencesWin) {
    preferencesWin.show()
    return
  }

  preferencesWin = new BrowserWindow({
    width: 400,
    height: 367,
    vibrancy: 'window',
    titleBarStyle: 'hidden',
    fullscreenable: false,
    resizable: false,
    alwaysOnTop: true,
    minimizable: false,
    hiddenInMissionControl: true,
    show: false,
    webPreferences: {
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js'),
      spellcheck: true
    }
  })

  preventZoom(preferencesWin)

  preferencesWin.loadFile(
    path.join(__dirname, 'preferences', 'preferences.html')
  )

  preferencesWin.once('ready-to-show', () => {
    preferencesWin.show()
  })

  preferencesWin.on('closed', () => {
    preferencesWin = null
  })

  preferencesWin.webContents.on('did-finish-load', () => {
    const accentColor = getAccentColor()
    if (accentColor) {
      preferencesWin.webContents.send('updateAccentColor', accentColor)
    } // theme.css handles fallback defaults
    preferencesWin.webContents.send('loadPreferences', storedData)
  })

  preferencesWin.on('blur', () => {
    preferencesWin.webContents.send('stateChange', 'blur')
  })

  preferencesWin.on('focus', () => {
    preferencesWin.webContents.send('stateChange', 'focus')
  })
}

function preventZoom (win) {
  win.webContents.on('before-input-event', (e, input) => {
    if (
      input.type === 'keyDown' &&
      (input.key === '=' || input.key === '-') &&
      (input.control || input.meta)
    ) {
      e.preventDefault()
    }
  })
}
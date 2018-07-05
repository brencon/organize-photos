const path = require('path')
const test = require('tape')
const walk = require('klaw')
const debug = require('debug')('organize-photos')
const spawn = require('child-process-promise').spawn
const exiftool = require('../lib/exiftool')
const organize = require('../lib/index')

const prefix = (f, ...prefixes) => path.join(process.cwd(), ...prefixes, f)
const prefixFiles = (files, ...prefixes) => files.map((f) => prefix(f, ...prefixes))

const destOnly = (obj) => Object.keys(obj).reduce((acc, k) => {
  if (Array.isArray(obj[k])) {
    acc[k] = obj[k].map(({ dest }) => dest)
  }
  return acc
}, {})

const pathSorter = (a, b) => {
  if (a < b) return -1
  if (a > b) return 1
  return 0
}

const getFsDest = (dest) => {
  const items = []
  return new Promise((resolve, reject) => walk(dest)
    .on('data', (item) => {
      const isDir = item.stats.isDirectory()
      const isHidden = path.basename(item.path) === '.' || path.basename(item.path)[0] === '.'
      if (!isDir && !isHidden) items.push(item.path)
    })
    .on('end', () => resolve(items.sort(pathSorter)))
  )
}

const run = (src, dest, options) => organize(
  Object.assign({ src, dest, log: debug, clean: true, real: true, verbose: true }, options)
).then((resp) => getFsDest(dest).then((files) => ({ resp, files })))

const cli = (src, dest, ...args) => {
  const promise = spawn('./lib/cli.js', ['--src', src, '--dest', dest, '--clean', '--real', '--verbose', ...args])
  promise.childProcess.stdout.on('data', (data) => debug(data.toString()))
  return promise.then(() => getFsDest(dest))
}

const noError = (t) => (err) => {
  t.ok(false, `Should not error: ${err}`)
  t.end()
}

test('(CLI) Photos can be organized by create date', (t) => {
  const src = 'test/fixtures'
  const dest = 'test/output'

  cli(src, dest)
    .then((files) => {
      const expected = [
        '2012/11-Nov/2012-11-03_07-17-09_nikon_corporation_nikon_d90_dsc0188.jpg',
        '2013/11-Nov/2013-11-01_17-33-56_screen_shot_2013-11-01_at_5.33.56_pm.png',
        '2016/01-Jan/2016-01-01_12-22-45_2016-01-01_12-22-45.jpg',
        '2016/01-Jan/2016-01-01_12-22-45_img_6412.jpg',
        '2016/11-Nov/2016-11-21_20-24-00_photo_on_11-21-16_at_8.24_pm_#4_(1).jpg',
        'UNKNOWN/test.txt',
        'UNSORTED/IMG_0415 1.jpg',
        'UNSORTED/IMG_0415.jpg',
        'UNSORTED/IMG_6412 1.jpg',
        'UNSORTED/IMG_6412.jpg',
        'UNSORTED/Photo on 1.jpg',
        'UNSORTED/Photo on 2.jpg',
        'UNSORTED/Photo on 3.jpg',
        'UNSORTED/Photo on 4.jpg',
        'UNSORTED/Photo on.jpg'
      ]

      files.forEach((f, i) => {
        t.equal(f, prefix(expected[i], dest))
      })

      t.end()
    })
    .catch(noError(t))
})

test('(CLI) Photos can be organized by create date and modify date', (t) => {
  const src = 'test/fixtures'
  const dest = 'test/output'

  cli(src, dest, '--exif-date', 'CreateDate', 'FileModifyDate')
    .then((files) => {
      t.equal(files[0], prefix('2012/11-Nov/2012-11-03_07-17-09_nikon_corporation_nikon_d90_dsc0188.jpg', dest))
      t.equal(files[files.length - 1], prefix('UNKNOWN/test.txt', dest))
      files.slice(1, -1).forEach((f) => {
        t.equal(f.indexOf('UNSORTED'), -1)
        t.equal(f.indexOf('UNKNOWN'), -1)
      })
      t.end()
    })
    .catch(noError(t))
})

test('(Module) Photos can be organized by create date and have exif modified', (t) => {
  const src = 'test/fixtures'
  const dest = 'test/output'

  run(src, dest)
    .then(({ resp, files }) => {
      const destResp = destOnly(resp)

      t.deepEqual(resp.METADATA, {
        SUCCESS: { src: 'Photo on 11-21-16 at 8.24 PM #4 (1).jpg', dest: '2016-11-21_20-24-00_photo_on_11-21-16_at_8.24_pm_#4_(1).jpg' },
        UNSORTED: { src: 'Photo on #4 (1) aaa.jpg', dest: 'Photo on.jpg' },
        UNKNOWN: { src: 'test.txt', dest: 'test.txt' }
      })

      t.deepEqual(Object.keys(destResp).sort(), ['SUCCESS', 'SUCCESS_METADATA', 'UNKNOWN', 'UNSORTED'])

      const expected = {
        SUCCESS: prefixFiles([
          '2012/11-Nov/2012-11-03_07-17-09_nikon_corporation_nikon_d90_dsc0188.jpg'
        ], dest),
        UNSORTED: prefixFiles([
          'UNSORTED/IMG_0415 1.jpg',
          'UNSORTED/IMG_0415.jpg',
          'UNSORTED/IMG_6412 1.jpg',
          'UNSORTED/IMG_6412.jpg',
          'UNSORTED/Photo on 1.jpg',
          'UNSORTED/Photo on 2.jpg',
          'UNSORTED/Photo on 3.jpg',
          'UNSORTED/Photo on 4.jpg',
          'UNSORTED/Photo on.jpg'
        ], dest),
        SUCCESS_METADATA: prefixFiles([
          '2013/11-Nov/2013-11-01_17-33-56_screen_shot_2013-11-01_at_5.33.56_pm.png',
          '2016/01-Jan/2016-01-01_12-22-45_2016-01-01_12-22-45.jpg',
          '2016/01-Jan/2016-01-01_12-22-45_img_6412.jpg',
          '2016/11-Nov/2016-11-21_20-24-00_photo_on_11-21-16_at_8.24_pm_#4_(1).jpg'
        ], dest),
        UNKNOWN: prefixFiles([
          'UNKNOWN/test.txt'
        ], dest)
      }

      t.deepEqual(destResp, expected)
      t.deepEqual(files, [...expected.SUCCESS, ...expected.SUCCESS_METADATA, ...expected.UNKNOWN, ...expected.UNSORTED])

      return resp
    })
    .then((resp) => {
      const ep = exiftool()
      return ep.open().then(() => ({ resp, ep }))
    })
    .then(({ resp, ep }) => {
      const readPromises = resp.SUCCESS_METADATA.map(({ src, dest }) => Promise.all([
        ep.readMetadata(src),
        ep.readMetadata(dest)
      ]).then((parts) => ({
        src: parts[0].data[0],
        dest: parts[1].data[0]
      })))

      return Promise.all(readPromises).then((resp) => {
        ep.close()
        return resp
      })
    })
    .then((resp) => {
      resp.forEach((item) => {
        const date = path.basename(item.dest.FileName, path.extname(item.dest.FileName)).replace(/-/g, ':').replace(/ \d+$/, '')
        if (item.src.CreationDate) {
          item.src.CreationDate.split('_').slice(0, -6).join(' ')
          t.notOk(item.src.CreationDate)
          t.equal(item.dest.CreationDate, date)
        }
      })
      t.end()
    })
    .catch(noError(t))
})

test('(Module) Photos can be organized by create date and modify date', (t) => {
  const src = 'test/fixtures'
  const dest = 'test/output'

  run(src, dest, { exifDate: ['CreateDate', 'FileModifyDate'] })
    .then(({ resp, files }) => {
      const destResp = destOnly(resp)

      t.deepEqual(Object.keys(destResp).sort(), ['SUCCESS', 'UNKNOWN'])
      t.deepEqual(files, [...destResp.SUCCESS, ...destResp.UNKNOWN])
      t.deepEqual(destResp.SUCCESS[0], prefix('2012/11-Nov/2012-11-03_07-17-09_nikon_corporation_nikon_d90_dsc0188.jpg', dest))

      destResp.SUCCESS.slice(1).forEach((f) => {
        t.equal(f.indexOf('UNSORTED'), -1)
        t.equal(f.indexOf('UNKNOWN'), -1)
      })

      t.deepEqual(destResp.UNKNOWN, prefixFiles([
        'UNKNOWN/test.txt'
      ], dest))

      t.end()
    })
    .catch(noError(t))
})

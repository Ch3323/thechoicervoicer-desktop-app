/* global process, module */
const repository = process.env.GITHUB_REPOSITORY
const [owner, repo] = repository?.split('/') ?? []
const unsignedHobby = process.env.DUB_STUDIO_UNSIGNED_HOBBY === '1'

module.exports = {
  appId: 'studio.collaborative.dubbing',
  productName: 'The Choicer Voicer At Home',
  directories: { output: 'release' },
  files: ['out/**/*', 'build/icon.ico', 'build/icon.png', 'package.json'],
  asar: true,
  asarUnpack: ['**/ffmpeg-static/ffmpeg.exe'],
  win: {
    target: [{ target: 'nsis', arch: ['x64'] }],
    artifactName: 'Dub-Studio-${version}-${arch}.${ext}',
    icon: "build/icon.ico",
    ...(unsignedHobby ? { verifyUpdateCodeSignature: false } : {}),
  },
  nsis: {
    oneClick: false,
    perMachine: false,
    installerIcon: "build/icon.ico",
    uninstallerIcon: "build/icon.ico",
  },
  ...(owner && repo ? { publish: [{ provider: 'github', owner, repo, private: false }] } : {}),
}

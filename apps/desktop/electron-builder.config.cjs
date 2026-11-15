/* global process, module */
const repository = process.env.GITHUB_REPOSITORY
const [owner, repo] = repository?.split('/') ?? []
const unsignedHobby = process.env.DUB_STUDIO_UNSIGNED_HOBBY === '1'

module.exports = {
  appId: 'studio.collaborative.dubbing',
  productName: 'Collaborative Dubbing Studio',
  directories: { output: 'release' },
  files: ['out/**/*', 'package.json'],
  asar: true,
  asarUnpack: ['**/ffmpeg-static/ffmpeg.exe'],
  win: {
    target: [{ target: 'nsis', arch: ['x64'] }],
    artifactName: 'Dub-Studio-${version}-${arch}.${ext}',
    ...(unsignedHobby ? { verifyUpdateCodeSignature: false } : {}),
  },
  nsis: { oneClick: false, perMachine: false },
  ...(owner && repo ? { publish: [{ provider: 'github', owner, repo, private: false }] } : {}),
}

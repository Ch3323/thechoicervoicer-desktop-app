/* global process, module */
const repository = process.env.GITHUB_REPOSITORY
const [owner, repo] = repository?.split('/') ?? []

module.exports = {
  appId: 'studio.collaborative.dubbing',
  productName: 'Collaborative Dubbing Studio',
  directories: { output: 'release' },
  files: ['out/**/*', 'package.json'],
  asar: true,
  asarUnpack: ['**/ffmpeg-static/ffmpeg.exe'],
  win: {
    target: [{ target: 'nsis', arch: ['x64'] }],
    artifactName: '${productName}-${version}-${arch}.${ext}',
  },
  nsis: { oneClick: false, perMachine: false },
  ...(owner && repo ? { publish: [{ provider: 'github', owner, repo, private: false }] } : {}),
}

Pod::Spec.new do |s|
  s.name           = 'MaidolRemoteCommands'
  s.version        = '1.0.0'
  s.summary        = 'MAIDOL lock screen next/previous track commands'
  s.description    = 'Registers MPRemoteCommandCenter next/previous track commands and forwards them to JS.'
  s.license        = 'UNLICENSED'
  s.author         = 'LOTUS AI'
  s.homepage       = 'https://maidol.ai.kr'
  s.platforms      = { :ios => '15.1' }
  s.source         = { git: '' }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'

  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES',
  }

  s.source_files = "**/*.{h,m,swift}"
end

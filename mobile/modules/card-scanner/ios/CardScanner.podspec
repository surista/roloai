Pod::Spec.new do |s|
  s.name           = 'CardScanner'
  s.version        = '1.0.0'
  s.summary        = 'Auto-capturing business card scanner'
  s.description    = 'Live edge detection with single-shot auto-capture and perspective crop'
  s.author         = 'surista'
  s.homepage       = 'https://docs.expo.dev/modules/'
  s.platforms      = {
    :ios => '16.4',
    :tvos => '16.4'
  }
  s.source         = { git: '' }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'

  # Swift/Objective-C compatibility
  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES',
  }

  s.source_files = "**/*.{h,m,mm,swift,hpp,cpp}"
end

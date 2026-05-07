application_id = 'org.ramez.terminator'

foreach size : ['128x128', '256x256', '512x512']
  icon_dir = 'hicolor' / size / 'apps'
  install_data(
    icon_dir / ('@0@.png').format(application_id),
    install_dir: get_option('datadir') / 'icons' / icon_dir
  )
endforeach

printf "bob" >./username.txt
printf "desktop" >./deviceName.txt
submit "//form" \
  --data 'username=username.txt' \
  --data 'deviceName=deviceName.txt'

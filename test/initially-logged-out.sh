goto --url "http://localhost:8080/"
assert_response_code_equal 200
assert_query_returns_equal "//p" "Logged out"

goto --url "http://localhost:8080/login"
assert_response_code_equal 200

printf "alice" >./username.txt
printf "iphone" >./deviceName.txt
submit "//form" \
  --data 'username=username.txt' \
  --data 'deviceName=deviceName.txt'
assert_response_code_equal 200
assert_query_returns_equal "//p" "User: alice, Device: iphone"

goto --url "http://localhost:8080/"
assert_response_code_equal 200
assert_query_returns_equal "//p" "Logged out"

goto --url "http://localhost:8080/has-session"
assert_response_code_equal 200
assert_query_returns_equal "//p" "false"

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

goto --url "http://localhost:8080/"
assert_response_code_equal 200
assert_query_returns_equal "//p" "User: alice, Device: iphone"

goto --url "http://localhost:8080/has-session"
assert_response_code_equal 200
assert_query_returns_equal "//p" "true"

goto --url "http://localhost:8080/"
assert_response_code_equal 200
assert_query_returns_equal "//p" "User: alice, Device: iphone"

goto --url "http://localhost:8080/logout"
assert_response_code_equal 200
assert_query_returns_equal "//p" "Logged out"

goto --url "http://localhost:8080/"
assert_response_code_equal 200
assert_query_returns_equal "//p" "Logged out"

goto --url "http://localhost:8080/has-session"
assert_response_code_equal 200
assert_query_returns_equal "//p" "false"

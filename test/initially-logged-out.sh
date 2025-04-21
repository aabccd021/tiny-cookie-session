goto --url "http://localhost:8080/"
assert_response_code_equal 200
assert_query_returns_equal "//p" "Logged out"

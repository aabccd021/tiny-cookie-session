assert_response_code_equal 200
assert_query_returns_equal "//p" "User: bob, Device: desktop"

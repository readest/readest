export const QUERY_GET_USER_ID = `
query GetUserId {
  me {
    id
    username
  }
}
`;

export const QUERY_SEARCH_BOOK = `
query SearchBook($query: String!) {
  search(query: $query, query_type: "Book", per_page: 1) {
    results
  }
}
`;

export const QUERY_GET_EDITION = `
query GetEdition($isbn: [String!]!, $user_id: Int!) {
  editions(
    where: { _or: [ { asin: { _in: $isbn } }, { isbn_10: { _in: $isbn } }, { isbn_13: { _in: $isbn } } ] }
    limit: 1
  ) {
    id
    pages
    reading_format_id
    book {
      id
      pages
      user_books(where: { user_id: { _eq: $user_id } }) {
        id
        status_id
        edition {
          id
          pages
          reading_format_id
        }
        user_book_reads(
          where: { finished_at: { _is_null: true } }
          order_by: { started_at: desc }
          limit: 1
        ) {
          id
          started_at
          edition {
            id
            pages
            reading_format_id
          }
        }
      }
    }
  }
}
`;

export const QUERY_GET_BOOK_USER_DATA = `
query GetBookUserData($book_id: Int!, $user_id: Int!) {
  editions(
    where: { book_id: { _eq: $book_id } }
    limit: 1
  ) {
    book {
      id
      pages
      user_books(where: { user_id: { _eq: $user_id } }) {
        id
        status_id
        edition {
          id
          pages
          reading_format_id
        }
        user_book_reads(
          where: { finished_at: { _is_null: true } }
          order_by: { started_at: desc }
          limit: 1
        ) {
          id
          started_at
          edition {
            id
            pages
            reading_format_id
          }
        }
      }
    }
  }
}
`;

export const MUTATION_INSERT_USER_BOOK = `
mutation InsertUserBook($object: UserBookCreateInput!) {
  insert_user_book(object: $object) {
    error
    user_book {
      id
      user_book_reads(
        where: { finished_at: { _is_null: true } }
        order_by: { started_at: desc }
        limit: 1
      ) {
        id
        started_at
      }
    }
  }
}
`;

export const MUTATION_UPDATE_USER_BOOK = `
mutation UpdateUserBook($user_book_id: Int!, $object: UserBookUpdateInput!) {
  update_user_book(id: $user_book_id, object: $object) {
    id
    error
    user_book {
      user_book_reads(
        where: { finished_at: { _is_null: true } }
        order_by: { started_at: desc }
        limit: 1
      ) {
        id
        started_at
      }
    }
  }
}
`;

export const MUTATION_INSERT_READ = `
mutation InsertRead($user_book_id: Int!, $edition_id: Int!, $progress_pages: Int!, $started_at: date!) {
  insert_user_book_read(
    user_book_id: $user_book_id
    user_book_read: {
      edition_id: $edition_id
      progress_pages: $progress_pages
      started_at: $started_at
    }
  ) { id error }
}
`;

export const MUTATION_UPDATE_READ = `
mutation UpdateRead($id: Int!, $progress_pages: Int!, $edition_id: Int!, $started_at: date!) {
  update_user_book_read(
    id: $id
    object: {
      edition_id: $edition_id
      started_at: $started_at
      progress_pages: $progress_pages
    }
  ) { id error }
}
`;

export const MUTATION_INSERT_JOURNAL = `
mutation InsertReadingJournal(
  $book_id: Int!, $edition_id: Int!, $event: String!, $entry: String!,
  $action_at: date, $page: Int!, $possible: Int!, $percent: Float!, $privacy_setting_id: Int!
) {
  insert_reading_journal(
    object: {
      book_id: $book_id
      edition_id: $edition_id
      event: $event
      privacy_setting_id: $privacy_setting_id
      entry: $entry
      tags: { category: "", spoiler: false, tag: "" }
      action_at: $action_at
      metadata: {
        position: { type: pages, value: $page, possible: $possible, percent: $percent }
      }
    }
  ) { errors id }
}
`;

export const MUTATION_UPDATE_JOURNAL = `
mutation UpdateReadingJournal(
  $id: Int!,
  $event: String!,
  $entry: String!,
  $action_at: date,
  $page: Int!,
  $possible: Int!,
  $percent: Float!,
  $privacy_setting_id: Int!
) {
  update_reading_journal(
    id: $id
    object: {
      event: $event
      entry: $entry
      privacy_setting_id: $privacy_setting_id
      tags: { category: "", spoiler: false, tag: "" }
      action_at: $action_at
      metadata: {
        position: { type: pages, value: $page, possible: $possible, percent: $percent }
      }
    }
  ) { errors id }
}
`;

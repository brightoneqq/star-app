// Central manifest of all books / units shown on the homepage and review page.
// Add a new unit: copy its HTML to units/<book>/<slug>/index.html, append one entry below.

window.MYSTAR_MANIFEST = {
    books: [
        {
            id: 'book1',
            title: 'Book 1 · 课本一',
            units: [
                {
                    slug: 'u3',
                    number: 'U3',
                    title: 'Unit 3',
                    cardCount: 32,
                    blankCount: 180
                },
                {
                    slug: 'u6',
                    number: 'U6',
                    title: 'Unit 6 · Famous people in history',
                    cardCount: 33,
                    blankCount: 192
                }
            ]
        }
    ]
};
